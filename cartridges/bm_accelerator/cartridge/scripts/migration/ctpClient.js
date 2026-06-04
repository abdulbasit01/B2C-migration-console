'use strict';

var HTTPClient = require('dw/net/HTTPClient');
var Encoding = require('dw/crypto/Encoding');
var Bytes = require('dw/util/Bytes');
var cfg = require('*/cartridge/scripts/migration/configAccessor');

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
    var body = 'grant_type=client_credentials';
    if (c.scopes) {
        body += '&scope=' + encodeURIComponent(c.scopes);
    }
    var res = httpPost(
        c.authUrl + '/oauth/token',
        { 'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    );
    if (res.status !== 200 || !res.data.access_token) {
        throw new Error('CTP auth failed (' + res.status + '): ' + JSON.stringify(res.data));
    }
    return res.data.access_token;
}

/**
 * Test CTP connection using config accessor credentials.
 * @returns {Object} connection result
 */
function testConnection() {
    return testConnectionWith(cfg.ctp);
}

/**
 * Test CTP connection with an explicit credential object.
 * @param {Object} creds - { projectKey, clientId, clientSecret, apiUrl, authUrl, scopes }
 * @returns {Object} { ok: true, project: { key, name } }
 */
function testConnectionWith(creds) {
    var c = creds;
    var credentials = toBase64(c.clientId + ':' + c.clientSecret);
    var body = 'grant_type=client_credentials';
    if (c.scopes) body += '&scope=' + encodeURIComponent(c.scopes);
    var authUrl = c.authUrl || 'https://auth.us-central1.gcp.commercetools.com';
    var tokenRes = httpPost(
        authUrl + '/oauth/token',
        { 'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    );
    if (tokenRes.status !== 200 || !tokenRes.data.access_token) {
        throw new Error('Authentication failed (' + tokenRes.status + '): invalid credentials or scopes.');
    }
    var token = tokenRes.data.access_token;
    var res = httpGet(c.apiUrl + '/' + c.projectKey, token, null);
    if (res.status !== 200) {
        throw new Error('Project not found (' + res.status + '): check project key and API URL.');
    }
    return { ok: true, project: { key: res.data.key, name: res.data.name || c.projectKey } };
}

/**
 * Get total count for a CTP endpoint.
 * @param {string} token - CTP access token
 * @param {string} endpoint - e.g. '/products'
 * @returns {number} total count
 */
function getCount(token, endpoint) {
    var c = cfg.ctp;
    var res = httpGet(c.apiUrl + '/' + c.projectKey + endpoint, token, { limit: '1' });
    return (res.status === 200 && res.data.total) ? res.data.total : 0;
}

/**
 * Fetch all records from a CTP endpoint with pagination.
 * @param {string} token - CTP access token
 * @param {string} endpoint - API endpoint path
 * @param {Object} extraParams - additional query params
 * @returns {Array} all records
 */
function fetchAll(token, endpoint, extraParams) {
    var c = cfg.ctp;
    var all = [];
    var offset = 0;
    var limit = 100;
    var total = null;
    var results;

    do {
        var params = { limit: String(limit), offset: String(offset) };
        if (extraParams) {
            Object.keys(extraParams).forEach(function (k) { params[k] = extraParams[k]; });
        }
        var res = httpGet(c.apiUrl + '/' + c.projectKey + endpoint, token, params);
        if (res.status !== 200) break;

        results = res.data.results || [];
        if (total === null) total = res.data.total || 0;
        for (var i = 0; i < results.length; i++) { all.push(results[i]); }
        offset += results.length;
    } while (offset < total && results.length > 0);

    return all;
}

/**
 * Get live schema counts from CTP broken down by entity type.
 * @returns {Object} counts by schema source
 */
function getSchemaCounts() {
    var token        = getCTPToken();
    var c            = cfg.ctp;
    var ptRes        = httpGet(c.apiUrl + '/' + c.projectKey + '/product-types', token, { limit: '500' });
    var ctRes        = httpGet(c.apiUrl + '/' + c.projectKey + '/types', token, { limit: '500' });
    var productTypes = (ptRes.status === 200 && ptRes.data.results) ? ptRes.data.results : [];
    var customTypes  = (ctRes.status === 200 && ctRes.data.results) ? ctRes.data.results : [];

    var productAttrCount = 0;
    for (var i = 0; i < productTypes.length; i++) {
        productAttrCount += (productTypes[i].attributes || []).length;
    }

    // Break down custom types by resourceTypeId
    var byResource = {};
    for (var j = 0; j < customTypes.length; j++) {
        var ct = customTypes[j];
        var ids = ct.resourceTypeIds || [];
        var fieldCount = (ct.fieldDefinitions || []).length;
        for (var k = 0; k < ids.length; k++) {
            var rid = ids[k];
            if (!byResource[rid]) byResource[rid] = { types: 0, fields: 0 };
            byResource[rid].types  += 1;
            byResource[rid].fields += fieldCount;
        }
    }

    return {
        productTypes:      productTypes.length,
        productAttributes: productAttrCount,
        customTypes:       customTypes.length,
        customFields:      customTypes.reduce(function (sum, t) { return sum + (t.fieldDefinitions || []).length; }, 0),
        byResource:        byResource
    };
}

/**
 * Fetch all CTP ProductType definitions.
 * @param {string} token - CTP access token
 * @returns {Array} ProductType array
 */
function fetchProductTypes(token) {
    return fetchAll(token, '/product-types', null);
}

/**
 * Fetch all CTP Custom Type definitions.
 * @param {string} token - CTP access token
 * @returns {Array} Type array
 */
function fetchCustomTypes(token) {
    return fetchAll(token, '/types', null);
}

module.exports = {
    getCTPToken:        getCTPToken,
    testConnection:     testConnection,
    testConnectionWith: testConnectionWith,
    getCount:           getCount,
    fetchAll:           fetchAll,
    getSchemaCounts:    getSchemaCounts,
    fetchProductTypes:  fetchProductTypes,
    fetchCustomTypes:   fetchCustomTypes
};
