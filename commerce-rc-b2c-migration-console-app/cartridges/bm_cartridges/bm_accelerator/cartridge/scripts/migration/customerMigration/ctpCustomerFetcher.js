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
 * Return total number of customers in the CT project.
 * @returns {number} total customer count
 */
function getCount() {
    var c     = cfg.ctp;
    var token = getToken();
    var res   = http.get(
        c.apiUrl + '/' + c.projectKey + '/customers?limit=1',
        { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT customer count failed (' + res.status + ')');
    }
    return res.data.total || 0;
}

/**
 * Fetch one page of customers from CT.
 * @param {number} offset - pagination offset
 * @param {number} limit  - page size (max 500)
 * @returns {{ results: Array, total: number }}
 */
function fetchBatch(offset, limit) {
    var c   = cfg.ctp;
    var tok = getToken();
    var qs  = '?limit=' + (limit || 5) + '&offset=' + (offset || 0) + '&sort=id+asc&withTotal=true';

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/customers' + qs,
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT customers fetch failed (' + res.status + ')');
    }
    return {
        results: res.data.results || [],
        total:   res.data.total   || 0
    };
}

/**
 * Convert a 32-char hex string (UUID without dashes) to standard UUID format.
 * If the string already contains dashes or is not 32 hex chars, it is returned as-is.
 * e.g. "8bd58511e17e4429acbebae8ac8d35f5" → "8bd58511-e17e-4429-acbe-bae8ac8d35f5"
 */
function normalizeUuid(id) {
    var clean = (id || '').trim().replace(/-/g, '');
    if (clean.length === 32 && /^[0-9a-fA-F]{32}$/.test(clean)) {
        return clean.slice(0, 8) + '-' +
               clean.slice(8, 12) + '-' +
               clean.slice(12, 16) + '-' +
               clean.slice(16, 20) + '-' +
               clean.slice(20);
    }
    return (id || '').trim();
}

/**
 * Fetch a single customer from CT by their ID.
 * Accepts both dashed UUIDs and plain 32-char hex strings (SFCC customer numbers).
 * @param {string} ctpId - CT customer UUID (with or without dashes)
 * @returns {Object|null} CT customer object, or null if not found (404)
 */
function fetchById(ctpId) {
    var c          = cfg.ctp;
    var tok        = getToken();
    var normalised = normalizeUuid(ctpId);
    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/customers/' + encodeURIComponent(normalised),
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status === 404) return null;
    if (res.status !== 200) {
        throw new Error('CT customer fetch failed (' + res.status + ') for id: ' + normalised);
    }
    return res.data;
}

module.exports = { getCount: getCount, fetchBatch: fetchBatch, fetchById: fetchById };
