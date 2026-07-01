'use strict';

var http     = require('*/cartridge/scripts/migration/core/http');
var cfg      = require('*/cartridge/scripts/migration/configAccessor');
var Encoding = require('dw/crypto/Encoding');
var Bytes    = require('dw/util/Bytes');

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function getToken() {
    var c    = cfg.ctp;
    var body = 'grant_type=client_credentials';

    var res = http.post(
        c.authUrl + '/oauth/token',
        {
            Authorization:  'Basic ' + toBase64(c.clientId + ':' + c.clientSecret),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    );
    if (res.status !== 200 || !res.data.access_token) {
        throw new Error('CTP auth failed (' + res.status + ')');
    }
    return res.data.access_token;
}

function ctpErrorDetail(res) {
    if (!res) return '';
    if (res.data && res.data.message) return String(res.data.message);
    if (res.data && res.data.errors && res.data.errors.length) {
        var err = res.data.errors[0];
        return err.message || err.title || JSON.stringify(err);
    }
    if (res.text) return String(res.text).substring(0, 300);
    return '';
}

function failCtp(label, res) {
    var detail = ctpErrorDetail(res);
    throw new Error(label + ' (' + res.status + ')' + (detail ? ': ' + detail : ''));
}

function exportKeySafe(key) {
    return String(key || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getLocalized(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return obj.en || obj['en-US'] || obj['en-GB'] || obj.default
        || (Object.keys(obj).length > 0 ? obj[Object.keys(obj)[0]] : '') || '';
}

function hasAddress(channel) {
    var addr = channel && channel.address;
    return !!(addr && (addr.country || addr.city || addr.streetName));
}

/**
 * Fetch all CTP stores from /stores.
 * @returns {Array}
 */
function fetchAllCtpStores() {
    var c      = cfg.ctp;
    var token  = getToken();
    var out    = [];
    var offset = 0;
    var limit  = 500;
    var batch;

    do {
        var qs = '?limit=' + limit + '&offset=' + offset + '&sort=id+asc&withTotal=true';
        var res = http.get(
            c.apiUrl + '/' + c.projectKey + '/stores' + qs,
            { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
        );
        if (res.status !== 200) {
            failCtp('CTP stores fetch failed', res);
        }
        batch = {
            results: res.data.results || [],
            total:   res.data.total   || 0
        };
        out = out.concat(batch.results);
        offset += batch.results.length;
    } while (batch.results.length === limit && offset < batch.total);

    return out;
}

/**
 * Fetch all CTP channels indexed by id (for address enrichment).
 * @returns {Object.<string, Object>}
 */
function fetchChannelMap() {
    var c      = cfg.ctp;
    var token  = getToken();
    var map    = {};
    var offset = 0;
    var limit  = 500;
    var batch;

    do {
        var qs = '?limit=' + limit + '&offset=' + offset + '&sort=id+asc&withTotal=true';
        var res = http.get(
            c.apiUrl + '/' + c.projectKey + '/channels' + qs,
            { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
        );
        if (res.status !== 200) {
            failCtp('CTP channels fetch failed', res);
        }
        batch = {
            results: res.data.results || [],
            total:   res.data.total   || 0
        };
        var i;
        for (i = 0; i < batch.results.length; i++) {
            var ch = batch.results[i];
            if (ch && ch.id) {
                map[ch.id] = ch;
            }
        }
        offset += batch.results.length;
    } while (batch.results.length === limit && offset < batch.total);

    return map;
}

/**
 * Find first linked supply/distribution channel with address.
 * @param {Object} store
 * @param {Object} channelById
 * @returns {Object|null}
 */
function findLinkedChannel(store, channelById) {
    if (!store || !channelById) return null;

    var refs = [];
    var i;

    if (store.supplyChannels && store.supplyChannels.length) {
        refs = refs.concat(store.supplyChannels);
    }
    if (store.distributionChannels && store.distributionChannels.length) {
        refs = refs.concat(store.distributionChannels);
    }

    for (i = 0; i < refs.length; i++) {
        var ref = refs[i];
        var ch  = ref && ref.id ? channelById[ref.id] : null;
        if (ch && hasAddress(ch)) {
            return ch;
        }
    }

    return null;
}

/**
 * @param {Array} stores
 * @param {Array<string>} refs
 * @returns {Array}
 */
function filterStoresByRefs(stores, refs) {
    if (!refs || !refs.length) return stores || [];

    var refSet = {};
    var i;
    for (i = 0; i < refs.length; i++) {
        refSet[String(refs[i])] = true;
    }

    var out = [];
    for (i = 0; i < stores.length; i++) {
        var store = stores[i];
        var ref   = store.key || store.id || '';
        if (refSet[ref] || (store.id && refSet[store.id]) || (store.key && refSet[store.key])) {
            out.push(store);
        }
    }
    return out;
}

/**
 * Summary for migration count endpoints.
 * @returns {{ storeCount: number }}
 */
function getFullStoreSummary() {
    var stores = fetchAllCtpStores();
    return { storeCount: stores.length };
}

module.exports = {
    fetchAllCtpStores:   fetchAllCtpStores,
    fetchChannelMap:     fetchChannelMap,
    findLinkedChannel:   findLinkedChannel,
    filterStoresByRefs:  filterStoresByRefs,
    getFullStoreSummary: getFullStoreSummary,
    exportKeySafe:       exportKeySafe,
    hasAddress:          hasAddress,
    getLocalized:        getLocalized
};
