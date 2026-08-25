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

function escWhere(val) {
    return String(val || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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

/**
 * @param {string} currency
 * @param {string} [channelId]
 * @param {boolean} [aggregate]
 * @returns {string}
 */
function buildWhereClause(currency, channelId, aggregate) {
    var parts = [];
    if (currency) {
        parts.push('value(currencyCode="' + escWhere(currency) + '")');
    }
    if (!aggregate && channelId && channelId !== 'all') {
        parts.push('channel(id="' + escWhere(channelId) + '")');
    }
    return parts.join(' and ');
}

function pricesBaseQs(currency, channelId, aggregate) {
    var where = buildWhereClause(currency, channelId, aggregate);
    return where ? ('?where=' + encodeURIComponent(where)) : '?';
}

/**
 * @param {string} currency
 * @param {string} [channelId]
 * @param {boolean} [aggregate]
 * @returns {number}
 */
function getCount(currency, channelId, aggregate) {
    var c     = cfg.ctp;
    var token = getToken();
    var qs    = pricesBaseQs(currency, channelId, aggregate);
    qs += (qs === '?' ? '' : '&') + 'limit=1';

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/standalone-prices' + qs,
        { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        failCtp('CT standalone-price count failed', res);
    }
    return res.data.total || 0;
}

/**
 * @param {number} offset
 * @param {number} limit
 * @param {string} [currency]
 * @param {string} [channelId]
 * @param {boolean} [aggregate]
 * @returns {{ results: Array, total: number }}
 */
function fetchBatch(offset, limit, currency, channelId, aggregate, sortField) {
    var c    = cfg.ctp;
    var tok  = getToken();
    var qs   = pricesBaseQs(currency, channelId, aggregate);
    var sort = sortField || (aggregate ? 'sku' : 'id');
    qs += (qs === '?' ? '' : '&')
        + 'limit=' + (limit || 500)
        + '&offset=' + (offset || 0)
        + '&sort=' + encodeURIComponent(sort + ' asc') + '&withTotal=true';

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/standalone-prices' + qs,
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        failCtp('CT standalone-price fetch failed', res);
    }
    return {
        results: res.data.results || [],
        total:   res.data.total   || 0
    };
}

/**
 * Fetch product distribution channels from CT.
 * @returns {Array<{id: string, key: string, name: string}>}
 */
function fetchDistributionChannels() {
    var c     = cfg.ctp;
    var token = getToken();
    var where = encodeURIComponent('roles contains any ("ProductDistribution")');
    var qs    = '?where=' + where + '&limit=500';

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/channels' + qs,
        { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        failCtp('CT distribution channels fetch failed', res);
    }

    var results = [];
    var rows    = (res.data && res.data.results) ? res.data.results : [];
    var i;
    for (i = 0; i < rows.length; i++) {
        var ch = rows[i];
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

function exportKeySafe(key) {
    return String(key || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function readSessionMap(key) {
    try {
        return JSON.parse(String(session.custom[key] || '{}'));
    } catch (e) {
        return {};
    }
}

function writeSessionMap(key, obj) {
    session.custom[key] = JSON.stringify(obj || {});
}

function buildTargetsFromMaps(aggByCurrency, byCurChannel, channelsById) {
    var targets    = [];
    var currencies = Object.keys(aggByCurrency).sort();
    var ci;

    for (ci = 0; ci < currencies.length; ci++) {
        var currency = currencies[ci];
        targets.push({
            exportKey:  'agg_' + exportKeySafe(currency),
            label:      currency + ' — All channels',
            subLabel:   'One SFCC pricebook per currency; deduplicates SKU prices across channels',
            currency:   currency,
            channelId:  'all',
            channelKey: '',
            aggregate:  true,
            priceCount: aggByCurrency[currency],
            source:     'standalone'
        });
    }

    var mapKeys = Object.keys(byCurChannel).sort();
    var ki;
    for (ki = 0; ki < mapKeys.length; ki++) {
        var parts  = mapKeys[ki].split('::');
        var cur2   = parts[0];
        var chId2  = parts[1];
        var chInfo = channelsById[chId2] || { id: chId2, key: chId2, name: chId2 };
        var chKey  = exportKeySafe(chInfo.key || chId2);
        targets.push({
            exportKey:  exportKeySafe(cur2) + '_ch_' + chKey,
            label:      cur2 + ' — ' + (chInfo.name || chInfo.key),
            subLabel:   'Distribution channel: ' + (chInfo.key || chId2),
            currency:   cur2,
            channelId:  chId2,
            channelKey: chInfo.key || '',
            aggregate:  false,
            priceCount: byCurChannel[mapKeys[ki]],
            source:     'standalone'
        });
    }

    return targets;
}

function channelsByIdFromList(channels) {
    var map = {};
    var i;
    for (i = 0; i < channels.length; i++) {
        map[channels[i].id] = channels[i];
    }
    return map;
}

function absorbStandaloneBatch(batch, aggByCurrency, byCurChannel) {
    var i;
    for (i = 0; i < batch.results.length; i++) {
        var p   = batch.results[i];
        var cur = p.value && p.value.currencyCode;
        if (!cur) continue;
        if (!aggByCurrency[cur]) aggByCurrency[cur] = 0;
        aggByCurrency[cur]++;
        var chId = (p.channel && p.channel.id) ? p.channel.id : null;
        if (chId) {
            var mapKey = cur + '::' + chId;
            if (!byCurChannel[mapKey]) byCurChannel[mapKey] = 0;
            byCurChannel[mapKey]++;
        }
    }
}

var DISC_PAGE = 500;
var SESS = {
    agg:      'pbDisc_std_agg',
    ch:       'pbDisc_std_ch',
    channels: 'pbDisc_std_channels',
    offset:   'pbDisc_std_offset',
    total:    'pbDisc_std_total'
};

function clearStandaloneDiscovery() {
    session.custom[SESS.offset] = '0';
    session.custom[SESS.total]  = '';
    writeSessionMap(SESS.agg, {});
    writeSessionMap(SESS.ch, {});
    session.custom[SESS.channels] = '';
}

/**
 * Process one page of standalone prices for discovery (avoids script timeout).
 * @param {number} offset
 * @param {boolean} reset
 * @returns {Object}
 */
function discoverStandaloneStep(offset, reset) {
    if (reset || offset === 0) {
        clearStandaloneDiscovery();
        var channels = fetchDistributionChannels();
        session.custom[SESS.channels] = JSON.stringify(channels);
    }

    var agg       = readSessionMap(SESS.agg);
    var byChannel = readSessionMap(SESS.ch);
    var curOffset = parseInt(session.custom[SESS.offset] || '0', 10);
    if (offset > 0) {
        curOffset = offset;
    }

    var batch = fetchBatch(curOffset, DISC_PAGE, '', '', true);
    if (!session.custom[SESS.total]) {
        session.custom[SESS.total] = String(batch.total || 0);
    }

    absorbStandaloneBatch(batch, agg, byChannel);
    writeSessionMap(SESS.agg, agg);
    writeSessionMap(SESS.ch, byChannel);

    var total      = parseInt(session.custom[SESS.total], 10) || 0;
    var nextOffset = curOffset + batch.results.length;
    session.custom[SESS.offset] = String(nextOffset);

    var done = batch.results.length === 0 || nextOffset >= total;
    if (!done) {
        return {
            done:       false,
            nextOffset: nextOffset,
            scanned:    nextOffset,
            total:      total,
            standalone: []
        };
    }

    var channelList = [];
    try {
        channelList = JSON.parse(session.custom[SESS.channels] || '[]');
    } catch (e2) {
        channelList = [];
    }

    clearStandaloneDiscovery();
    return {
        done:       true,
        nextOffset: nextOffset,
        scanned:    total,
        total:      total,
        standalone: buildTargetsFromMaps(agg, byChannel, channelsByIdFromList(channelList))
    };
}

/**
 * Scan standalone prices and build export targets (per currency + per channel/currency).
 * @returns {Array}
 */
function discoverPricebookTargets() {
    var result = discoverStandaloneStep(0, true);
    while (!result.done) {
        result = discoverStandaloneStep(result.nextOffset, false);
    }
    return result.standalone || [];
}

module.exports = {
    getCount:                    getCount,
    fetchBatch:                  fetchBatch,
    fetchDistributionChannels: fetchDistributionChannels,
    discoverPricebookTargets:    discoverPricebookTargets,
    discoverStandaloneStep:      discoverStandaloneStep
};
