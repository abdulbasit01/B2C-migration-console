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
    if (c.scopes) body += '&scope=' + encodeURIComponent(c.scopes);

    var res = http.post(
        c.authUrl + '/oauth/token',
        {
            Authorization:  'Basic ' + toBase64(c.clientId + ':' + c.clientSecret),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    );
    if (res.status !== 200 || !res.data.access_token) {
        throw new Error('CT auth failed (' + res.status + ')');
    }
    return res.data.access_token;
}

function normalizeChannelId(supplyChannelId) {
    if (!supplyChannelId || supplyChannelId === 'all') return '';
    return String(supplyChannelId);
}

/**
 * @param {string} [supplyChannelId]
 * @returns {string}
 */
function buildWhereClause(supplyChannelId) {
    var channelId = normalizeChannelId(supplyChannelId);
    if (!channelId) return '';
    return 'supplyChannel(id="' + channelId.replace(/"/g, '\\"') + '")';
}

/**
 * @param {string} [supplyChannelId]
 * @returns {string}
 */
function inventoryBaseQs(supplyChannelId) {
    var where = buildWhereClause(supplyChannelId);
    return where ? ('?where=' + encodeURIComponent(where)) : '?';
}

/**
 * Return total inventory entries in CT (optionally filtered by supply channel).
 * @param {string} [supplyChannelId]
 * @returns {number}
 */
function getCount(supplyChannelId) {
    var c     = cfg.ctp;
    var token = getToken();
    var qs    = inventoryBaseQs(supplyChannelId);
    if (qs === '?') {
        qs += 'limit=1';
    } else {
        qs += '&limit=1';
    }

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/inventory' + qs,
        { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT inventory count failed (' + res.status + ')');
    }
    return res.data.total || 0;
}

/**
 * Fetch one page of inventory entries from CT.
 * @param {number} offset
 * @param {number} limit
 * @param {string} [supplyChannelId]
 * @param {string} [sortField] - CT sort field, e.g. id or sku
 * @returns {{ results: Array, total: number }}
 */
function fetchBatch(offset, limit, supplyChannelId, sortField) {
    var c   = cfg.ctp;
    var tok = getToken();
    var qs  = inventoryBaseQs(supplyChannelId);
    var sort = sortField || 'id';
    if (qs === '?') {
        qs += 'limit=' + (limit || 500) + '&offset=' + (offset || 0)
            + '&sort=' + encodeURIComponent(sort + ' asc') + '&withTotal=true';
    } else {
        qs += '&limit=' + (limit || 500) + '&offset=' + (offset || 0)
            + '&sort=' + encodeURIComponent(sort + ' asc') + '&withTotal=true';
    }

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/inventory' + qs,
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT inventory fetch failed (' + res.status + ')');
    }
    return {
        results: res.data.results || [],
        total:   res.data.total   || 0
    };
}

/**
 * Fetch inventory supply channels from CT.
 * Falls back to all channels when none match InventorySupply filter.
 * @returns {Array<{id: string, key: string, name: string}>}
 */
function fetchSupplyChannels() {
    var c     = cfg.ctp;
    var token = getToken();

    function fetchWithWhere(whereClause) {
        var qs = whereClause
            ? ('?where=' + encodeURIComponent(whereClause) + '&limit=500')
            : '?limit=500';

        var res = http.get(
            c.apiUrl + '/' + c.projectKey + '/channels' + qs,
            { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
        );
        if (res.status !== 200) {
            throw new Error('CT supply channels fetch failed (' + res.status + ')');
        }
        return (res.data && res.data.results) ? res.data.results : [];
    }

    var rows = fetchWithWhere('roles contains any ("InventorySupply")');
    if (!rows.length) {
        rows = fetchWithWhere('');
    }

    var results = [];
    var i;
    for (i = 0; i < rows.length; i++) {
        var ch = rows[i];
        var roles = ch.roles || [];
        if (roles.length && roles.indexOf('InventorySupply') < 0) {
            continue;
        }
        var name = ch.name;
        if (name && typeof name === 'object') {
            name = name.en || name['en-US'] || name.default || ch.key || ch.id;
        }
        results.push({
            id:   ch.id,
            key:  ch.key || ch.id,
            name: name || ch.key || ch.id
        });
    }
    return results;
}

module.exports = {
    getCount:             getCount,
    fetchBatch:           fetchBatch,
    fetchSupplyChannels:  fetchSupplyChannels
};
