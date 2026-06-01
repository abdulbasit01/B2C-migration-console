'use strict';

var HTTPClient = require('dw/net/HTTPClient');
var Encoding = require('dw/crypto/Encoding');
var Bytes = require('dw/util/Bytes');
var cfg = require('*/cartridge/scripts/migration/config');

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function httpPost(url, headers, body) {
    var client = new HTTPClient();
    client.setTimeout(30000);
    client.open('POST', url);
    Object.keys(headers).forEach(function (h) { client.setRequestHeader(h, headers[h]); });
    client.send(body || '');
    var text = client.getText();
    return { status: client.getStatusCode(), data: JSON.parse(text || '{}') };
}

function httpGet(url, token, params) {
    var qs = '';
    if (params) {
        var parts = [];
        Object.keys(params).forEach(function (k) { parts.push(k + '=' + encodeURIComponent(params[k])); });
        if (parts.length) qs = '?' + parts.join('&');
    }
    var client = new HTTPClient();
    client.setTimeout(30000);
    client.open('GET', url + qs);
    client.setRequestHeader('Authorization', 'Bearer ' + token);
    client.setRequestHeader('Content-Type', 'application/json');
    client.send();
    var text = client.getText();
    return { status: client.getStatusCode(), data: JSON.parse(text || '{}') };
}

/**
 * Get CTP OAuth2 token using client_credentials grant.
 * @returns {string} access_token
 */
function getCTPToken() {
    var c = cfg.ctp;
    var credentials = toBase64(c.clientId + ':' + c.clientSecret);
    var body = 'grant_type=client_credentials&scope=' + encodeURIComponent(c.scopes);

    var res = httpPost(
        c.authUrl + '/oauth/token',
        {
            'Authorization': 'Basic ' + credentials,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    );

    if (res.status !== 200 || !res.data.access_token) {
        throw new Error('CTP auth failed (' + res.status + '): ' + JSON.stringify(res.data));
    }
    return res.data.access_token;
}

/**
 * Test CTP connection — returns { ok, project } or throws.
 */
function testConnection() {
    var token = getCTPToken();
    var c = cfg.ctp;
    var res = httpGet(c.apiUrl + '/' + c.projectKey, token, null);
    if (res.status !== 200) {
        throw new Error('CTP project fetch failed (' + res.status + ')');
    }
    return { ok: true, project: { key: res.data.key, name: res.data.name || c.projectKey } };
}

/**
 * Get total count for a CTP endpoint.
 * @param {string} token
 * @param {string} endpoint - e.g. '/products'
 * @returns {number}
 */
function getCount(token, endpoint) {
    var c = cfg.ctp;
    var res = httpGet(c.apiUrl + '/' + c.projectKey + endpoint, token, { limit: '1' });
    return (res.status === 200 && res.data.total) ? res.data.total : 0;
}

/**
 * Fetch all records from a CTP endpoint with pagination.
 * @param {string} token
 * @param {string} endpoint
 * @param {Object} extraParams
 * @returns {Array}
 */
function fetchAll(token, endpoint, extraParams) {
    var c = cfg.ctp;
    var all = [];
    var offset = 0;
    var limit = 100;
    var total = null;

    do {
        var params = { limit: String(limit), offset: String(offset) };
        if (extraParams) {
            Object.keys(extraParams).forEach(function (k) { params[k] = extraParams[k]; });
        }
        var res = httpGet(c.apiUrl + '/' + c.projectKey + endpoint, token, params);
        if (res.status !== 200) break;

        var results = res.data.results || [];
        if (total === null) total = res.data.total || 0;

        for (var i = 0; i < results.length; i++) { all.push(results[i]); }
        offset += results.length;
    } while (offset < total && results.length > 0);

    return all;
}

/**
 * Get live entity counts from CTP — returns { products, categories, customers, inventory }.
 */
function getEntityCounts() {
    var token = getCTPToken();
    return {
        products:   getCount(token, '/products'),
        categories: getCount(token, '/categories'),
        customers:  getCount(token, '/customers'),
        inventory:  getCount(token, '/inventory')
    };
}

module.exports = {
    getCTPToken: getCTPToken,
    testConnection: testConnection,
    getCount: getCount,
    fetchAll: fetchAll,
    getEntityCounts: getEntityCounts
};
