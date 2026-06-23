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
        throw new Error('CTP auth failed (' + res.status + ')');
    }
    return res.data.access_token;
}

/**
 * Return total number of customers in the CTP project.
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
        throw new Error('CTP customer count failed (' + res.status + ')');
    }
    return res.data.total || 0;
}

/**
 * Fetch one page of customers from CTP.
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
        throw new Error('CTP customers fetch failed (' + res.status + ')');
    }
    return {
        results: res.data.results || [],
        total:   res.data.total   || 0
    };
}

/**
 * Fetch a single customer from CTP by their ID.
 * @param {string} ctpId - CTP customer UUID
 * @returns {Object|null} CTP customer object, or null if not found (404)
 */
function fetchById(ctpId) {
    var c   = cfg.ctp;
    var tok = getToken();
    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/customers/' + encodeURIComponent(ctpId),
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status === 404) return null;
    if (res.status !== 200) {
        throw new Error('CTP customer fetch failed (' + res.status + ') for id: ' + ctpId);
    }
    return res.data;
}

module.exports = { getCount: getCount, fetchBatch: fetchBatch, fetchById: fetchById };
