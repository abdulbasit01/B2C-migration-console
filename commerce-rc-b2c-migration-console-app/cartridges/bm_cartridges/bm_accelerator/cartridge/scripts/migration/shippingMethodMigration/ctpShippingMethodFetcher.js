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

/**
 * Return total number of shipping methods in the CT project.
 * @returns {number}
 */
function getCount() {
    var c     = cfg.ctp;
    var token = getToken();
    var res   = http.get(
        c.apiUrl + '/' + c.projectKey + '/shipping-methods?limit=1',
        { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT shipping method count failed (' + res.status + ')');
    }
    return res.data.total || 0;
}

/**
 * Fetch one page of shipping methods from CT.
 * @param {number} offset
 * @param {number} limit
 * @returns {{ results: Array, total: number }}
 */
function fetchBatch(offset, limit) {
    var c   = cfg.ctp;
    var tok = getToken();
    var qs  = '?limit=' + (limit || 50) + '&offset=' + (offset || 0) + '&sort=id+asc&withTotal=true&expand=taxCategory';

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/shipping-methods' + qs,
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT shipping methods fetch failed (' + res.status + ')');
    }
    return {
        results: res.data.results || [],
        total:   res.data.total   || 0
    };
}

/**
 * Fetch a single shipping method by CT key or UUID.
 * @param {string} ctpKeyOrId
 * @returns {Object|null}
 */
function fetchByKeyOrId(ctpKeyOrId) {
    var c   = cfg.ctp;
    var tok = getToken();
    var id  = (ctpKeyOrId || '').trim();
    if (!id) return null;

    var byKey = http.get(
        c.apiUrl + '/' + c.projectKey + '/shipping-methods/key=' + encodeURIComponent(id) + '?expand=taxCategory',
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (byKey.status === 200 && byKey.data) return byKey.data;

    var byId = http.get(
        c.apiUrl + '/' + c.projectKey + '/shipping-methods/' + encodeURIComponent(id) + '?expand=taxCategory',
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (byId.status === 404) return null;
    if (byId.status !== 200) {
        throw new Error('CT shipping method fetch failed (' + byId.status + ') for id: ' + id);
    }
    return byId.data;
}

/**
 * Fetch all shipping methods from CT (paginated).
 * @returns {{ methods: Array, total: number }}
 */
function fetchAll() {
    var all    = [];
    var offset = 0;
    var limit  = 500;
    var total  = 0;
    var results = [];

    do {
        var batch   = fetchBatch(offset, limit);
        results     = batch.results || [];
        total       = batch.total || 0;
        for (var i = 0; i < results.length; i++) {
            all.push(results[i]);
        }
        offset += results.length;
    } while (offset < total && results.length > 0);

    return { methods: all, total: total };
}

module.exports = {
    getCount:         getCount,
    fetchBatch:       fetchBatch,
    fetchByKeyOrId:   fetchByKeyOrId,
    fetchAll:         fetchAll
};
