'use strict';

/**
 * SAP Commerce Cloud (Hybris) OCC v2 REST API helper.
 * Mirrors core/shopifyApi.js: OAuth2 client-credentials token exchange with
 * a module-level cache, Bearer auth headers, and OCC offset/pageSize pagination.
 */

var serviceHttp = require('*/cartridge/scripts/migration/core/serviceHttp');
var cfg         = require('*/cartridge/scripts/migration/configAccessor');

var _cachedToken    = null;
var _tokenExpiresAt = 0;

/**
 * @param {Object} [override]
 * @returns {Object} { baseUrl, baseSite, clientId, clientSecret }
 */
function getCreds(override) {
    var c = override || cfg.sap || {};
    if (!c.baseUrl || !c.baseSite) {
        throw new Error('SAP Commerce credentials are not configured. Connect in Data Wizard Step 1.');
    }
    if (!c.clientId || !c.clientSecret) {
        throw new Error('Enter the SAP Commerce OAuth Client ID and Secret (client_credentials grant).');
    }
    return c;
}

/**
 * Exchange client ID/secret for a Bearer access token via OCC's OAuth2 endpoint.
 * @param {Object} [creds]
 * @returns {string}
 */
function fetchAccessToken(creds) {
    if (_cachedToken && Date.now() < _tokenExpiresAt - 60000) {
        return _cachedToken;
    }

    var c       = getCreds(creds);
    var baseUrl = String(c.baseUrl || '').replace(/\/$/, '');
    var body    = 'grant_type=client_credentials'
        + '&client_id='     + encodeURIComponent(c.clientId)
        + '&client_secret=' + encodeURIComponent(c.clientSecret);

    var res = serviceHttp.post('sap', baseUrl + '/authorizationserver/oauth/token', {
        'Content-Type': 'application/x-www-form-urlencoded'
    }, body);

    if (res.status !== 200 || !res.data || !res.data.access_token) {
        var detail = (res.data && res.data.error_description) || res.text || ('HTTP ' + res.status);
        throw new Error('SAP Commerce token request failed: ' + detail);
    }

    _cachedToken    = res.data.access_token;
    _tokenExpiresAt = Date.now() + (res.data.expires_in || 3600) * 1000;
    return _cachedToken;
}

/**
 * @param {Object} [creds]
 * @returns {string}
 */
function getAccessToken(creds) {
    return fetchAccessToken(creds);
}

/**
 * OCC v2 base path for the configured base site, e.g. https://host/occ/v2/apparel-uk
 * @param {Object} [creds]
 * @returns {string}
 */
function occBase(creds) {
    var c       = getCreds(creds);
    var baseUrl = String(c.baseUrl || '').replace(/\/$/, '');
    return baseUrl + '/occ/v2/' + c.baseSite;
}

/**
 * @param {Object} [creds]
 * @returns {Object}
 */
function authHeaders(creds) {
    return {
        Authorization:  'Bearer ' + getAccessToken(creds),
        'Content-Type': 'application/json'
    };
}

/**
 * @param {string} method
 * @param {string} url
 * @param {Object} headers
 * @param {string} [body]
 * @returns {{ status: number, data: Object, text: string, link: string }}
 */
function send(method, url, headers, body) {
    return serviceHttp.request('sap', method, url, headers, body);
}

/**
 * @param {string} path - path after the base-site OCC base (e.g. /products/search)
 * @param {Object} [creds]
 * @returns {{ status: number, data: Object, text: string, link: string }}
 */
function get(path, creds) {
    var res = send('GET', occBase(creds) + path, authHeaders(getCreds(creds)));
    if (res.status >= 400) {
        var detail = (res.data && res.data.errors && JSON.stringify(res.data.errors).substring(0, 200))
            || (res.text || '').substring(0, 200);
        throw new Error('SAP Commerce OCC API failed (' + res.status + ')' + (detail ? ': ' + detail : ''));
    }
    return res;
}

module.exports = {
    getCreds:         getCreds,
    getAccessToken:   getAccessToken,
    fetchAccessToken: fetchAccessToken,
    occBase:          occBase,
    authHeaders:      authHeaders,
    send:             send,
    get:              get
};
