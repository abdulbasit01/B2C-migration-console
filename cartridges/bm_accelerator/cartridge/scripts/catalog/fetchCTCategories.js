'use strict';

var Logger   = require('dw/system/Logger');
var cfg      = require('*/cartridge/scripts/migration/configAccessor');
var Bytes    = require('dw/util/Bytes');
var Encoding = require('dw/crypto/Encoding');

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

/**
 * Auth using exact values from config.defaults.js
 * authUrl:  https://auth.us-central1.gcp.commercetools.com
 * endpoint: https://auth.us-central1.gcp.commercetools.com/oauth/token
 * scope:    manage_project:royal-cyber-b2c-accelerator-wd
 */
function getCTAuthToken() {
    var c = cfg.ctp;

    if (!c || !c.authUrl || !c.clientId || !c.clientSecret || !c.projectKey) {
        Logger.error('getCTAuthToken: missing config. ctp={0}', JSON.stringify(c));
        return null;
    }

    // Build token URL — append /oauth/token to authUrl
    var tokenUrl = c.authUrl + '/oauth/token';

    // Build scope — required for CT API
    var scope    = 'manage_project:' + c.projectKey;

    // Build body
    var body     = 'grant_type=client_credentials&scope=' + encodeURIComponent(scope);

    // Build Basic auth header
    var credentials = c.clientId + ':' + c.clientSecret;
    var basicAuth   = 'Basic ' + toBase64(credentials);

    Logger.info('getCTAuthToken: POST {0} scope={1}', tokenUrl, scope);

    try {
        var client = new dw.net.HTTPClient();
        client.open('POST', tokenUrl);
        client.setRequestHeader('Authorization', basicAuth);
        client.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        client.setTimeout(10000);
        client.send(body);

        Logger.info('getCTAuthToken: status={0} response={1}',
            client.statusCode, client.text);

        if (client.statusCode !== 200) {
            Logger.error('getCTAuthToken failed: status={0} body={1}',
                client.statusCode, client.text);
            return null;
        }

        var data = JSON.parse(client.text);

        if (!data.access_token) {
            Logger.error('getCTAuthToken: no access_token in response: {0}', client.text);
            return null;
        }

        Logger.info('getCTAuthToken: success, token type={0}', data.token_type);
        return data.access_token;

    } catch (e) {
        Logger.error('getCTAuthToken exception: {0}', e.message);
        return null;
    }
}

/**
 * Fetch all categories from CT with pagination.
 * apiUrl:       https://api.us-central1.gcp.commercetools.com
 * projectKey:   royal-cyber-b2c-accelerator-wd
 * endpoint:     GET /royal-cyber-b2c-accelerator-wd/categories
 */
function fetchAllCategories(token) {
    var c             = cfg.ctp;
    var allCategories = [];
    var limit         = 500;
    var offset        = 0;
    var total         = null;

    do {
        var url = c.apiUrl + '/' + c.projectKey
            + '/categories?limit=' + limit
            + '&offset=' + offset
            + '&withTotal=true';

        Logger.info('fetchAllCategories: GET {0}', url);

        try {
            var client = new dw.net.HTTPClient();
            client.open('GET', url);
            client.setRequestHeader('Authorization', 'Bearer ' + token);
            client.setRequestHeader('Content-Type', 'application/json');
            client.setTimeout(30000);
            client.send();

            if (client.statusCode !== 200) {
                Logger.error('fetchAllCategories failed at offset {0}: status={1} body={2}',
                    offset, client.statusCode, client.text);
                break;
            }

            var response = JSON.parse(client.text);

            // Capture total on first request
            if (total === null) {
                total = response.total || 0;
                Logger.info('fetchAllCategories: total={0}', total);
            }

            var results = response.results || [];
            results.forEach(function (cat) {
                allCategories.push(cat);
            });

            Logger.info('fetchAllCategories: fetched {0} at offset {1}',
                results.length, offset);

            offset += limit;

        } catch (e) {
            Logger.error('fetchAllCategories exception at offset {0}: {1}',
                offset, e.message);
            break;
        }

    } while (total !== null && offset < total);

    Logger.info('fetchAllCategories: complete, total fetched={0}', allCategories.length);
    return allCategories;
}

/**
 * Fetch a single page of CT categories and return with idToKey map for parent resolution.
 */
function fetchCategoriesPage(token, limit, offset) {
    var c   = cfg.ctp;
    limit   = limit  || 500;
    offset  = offset || 0;

    var url = c.apiUrl + '/' + c.projectKey
        + '/categories?limit=' + limit
        + '&offset=' + offset
        + '&withTotal=true';

    var client = new dw.net.HTTPClient();
    client.open('GET', url);
    client.setRequestHeader('Authorization', 'Bearer ' + token);
    client.setRequestHeader('Content-Type', 'application/json');
    client.setTimeout(30000);
    client.send();

    if (client.statusCode !== 200) {
        throw new Error('CT fetch failed: ' + client.statusCode + ' ' + client.text);
    }

    var data    = JSON.parse(client.text);
    var results = data.results || [];

    // Build idToKey map from this page for parent resolution
    var idToKey = {};
    results.forEach(function (cat) {
        if (cat.key) { idToKey[cat.id] = cat.key; }
    });

    return { results: results, total: data.total || 0, idToKey: idToKey };
}

module.exports = {
    getCTAuthToken     : getCTAuthToken,
    fetchAllCategories : fetchAllCategories,
    fetchCategoriesPage: fetchCategoriesPage
};