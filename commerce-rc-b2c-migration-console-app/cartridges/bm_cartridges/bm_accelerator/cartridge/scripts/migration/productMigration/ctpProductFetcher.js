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
 * Return total number of products in the CT project.
 * @returns {number}
 */
function getCount() {
    var c     = cfg.ctp;
    var token = getToken();
    var res   = http.get(
        c.apiUrl + '/' + c.projectKey + '/products?limit=1',
        { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT product count failed (' + res.status + ')');
    }
    return res.data.total || 0;
}

/**
 * Fetch one page of products from CT.
 * @param {number} offset
 * @param {number} limit  - max 500
 * @returns {{ results: Array, total: number }}
 */
function fetchBatch(offset, limit) {
    var c   = cfg.ctp;
    var tok = getToken();
    var qs  = '?limit=' + (limit || 500) + '&offset=' + (offset || 0)
        + '&sort=id+asc&withTotal=true'
        + '&expand=productType&expand=masterData.current.categories[*]';

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/products' + qs,
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT products fetch failed (' + res.status + ')');
    }
    return {
        results: res.data.results || [],
        total:   res.data.total   || 0
    };
}

/**
 * Fetch a single product from CT by its ID (UUID).
 * @param {string} productId
 * @returns {Object} CT product object
 */
function fetchById(productId) {
    var c   = cfg.ctp;
    var tok = getToken();
    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/products/' + encodeURIComponent(productId)
            + '?expand=productType&expand=masterData.current.categories[*]',
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT product fetch failed for ID ' + productId + ' (' + res.status + ')');
    }
    return res.data;
}

/**
 * CT category UUID → SFCC category-id (key when present, else UUID).
 * Uses dw.util.HashMap — a plain JS object would exceed api.jsObjectSize (2000).
 * @returns {dw.util.HashMap}
 */
function fetchCategoryIdMap() {
    var HashMap = require('dw/util/HashMap');
    var c     = cfg.ctp;
    var tok   = getToken();
    var map   = new HashMap();
    var limit = 500;
    var offset = 0;
    var total = null;

    do {
        var res = http.get(
            c.apiUrl + '/' + c.projectKey + '/categories?limit=' + limit
                + '&offset=' + offset + '&withTotal=true',
            { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
        );
        if (res.status !== 200) break;
        if (total === null) total = res.data.total || 0;
        var results = res.data.results || [];
        var i;
        for (i = 0; i < results.length; i++) {
            var cat = results[i];
            if (cat && cat.id) map.put(cat.id, cat.key || cat.id);
        }
        offset += limit;
    } while (total !== null && offset < total);

    return map;
}

module.exports = {
    getCount: getCount,
    fetchBatch: fetchBatch,
    fetchById: fetchById,
    fetchCategoryIdMap: fetchCategoryIdMap
};
