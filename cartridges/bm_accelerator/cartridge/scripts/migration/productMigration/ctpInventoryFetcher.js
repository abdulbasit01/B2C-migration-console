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
    var res  = http.post(
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
 * Fetch CTP inventory entries for a list of SKUs.
 * Chunked into groups of 50 to stay within URL-length limits.
 *
 * @param {string[]} skus
 * @returns {Array} CTP inventory entry objects
 */
function fetchForSkus(skus) {
    if (!skus || !skus.length) return [];

    var c       = cfg.ctp;
    var token   = getToken();
    var headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    var results = [];
    var CHUNK   = 50;

    for (var i = 0; i < skus.length; i += CHUNK) {
        var chunk    = skus.slice(i, i + CHUNK);
        var inClause = 'sku in (' + chunk.map(function (s) {
            return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        }).join(',') + ')';
        var qs  = '?where=' + encodeURIComponent(inClause) + '&limit=500';
        var res = http.get(c.apiUrl + '/' + c.projectKey + '/inventory' + qs, headers);
        if (res.status === 200 && res.data && res.data.results) {
            for (var ri = 0; ri < res.data.results.length; ri++) {
                results.push(res.data.results[ri]);
            }
        }
    }
    return results;
}

module.exports = { fetchForSkus: fetchForSkus };
