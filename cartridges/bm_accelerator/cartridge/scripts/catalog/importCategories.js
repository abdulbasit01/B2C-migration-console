'use strict';

var Logger = require('dw/system/Logger');
var Site = require('dw/system/Site');

/**
 * Gets OCAPI Data API token (Business Manager user credential grant).
 */
function getOCAPIToken() {
    var bmClientID = Site.current.getCustomPreferenceValue('migrationOCAPIClientID');
    var bmClientSecret = Site.current.getCustomPreferenceValue('migrationOCAPIClientSecret');
    var instanceHost = Site.current.getCustomPreferenceValue('sfccInstanceHost'); // e.g. yoursandbox.commercecloud.salesforce.com

    var tokenURL = 'https://account.demandware.com/dw/oauth2/access_token?client_id=' + bmClientID;
    var httpClient = new dw.net.HTTPClient();
    httpClient.open('POST', tokenURL);
    httpClient.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    httpClient.send('grant_type=client_credentials&client_id=' + bmClientID + '&client_secret=' + bmClientSecret);

    if (httpClient.statusCode === 200) {
        return JSON.parse(httpClient.text).access_token;
    }
    Logger.error('OCAPI token error: {0}', httpClient.text);
    return null;
}

/**
 * Upserts a single category via OCAPI Data API.
 * PUT /dw/data/v23_2/catalogs/{catalogId}/categories/{categoryId}
 * 
 * @param {String} token - OCAPI bearer token
 * @param {String} catalogId - target SFCC catalog ID
 * @param {Object} sfccCategory - transformed category object
 * @param {String} instanceHost - SFCC instance hostname
 * @returns {Boolean} success
 */
function importCategory(token, catalogId, sfccCategory, instanceHost) {
    var url = 'https://' + instanceHost + '/s/-/dw/data/v23_2/catalogs/' + catalogId + '/categories/' + sfccCategory.id;

    var payload = {
        id: sfccCategory.id,
        name: sfccCategory.name,
        description: sfccCategory.description,
        parent_category_id: sfccCategory.parentId,
        online: sfccCategory.online,
        position: sfccCategory.position,
        page_title: sfccCategory.pageTitle,
        page_description: sfccCategory.pageDescription,
        c_ctSlug: sfccCategory.customAttributes.ctSlug || '',
        c_ctId: sfccCategory.customAttributes.ctId || ''
    };

    var httpClient = new dw.net.HTTPClient();
    httpClient.open('PUT', url);
    httpClient.setRequestHeader('Authorization', 'Bearer ' + token);
    httpClient.setRequestHeader('Content-Type', 'application/json');
    httpClient.send(JSON.stringify(payload));

    if (httpClient.statusCode === 200 || httpClient.statusCode === 201) {
        return true;
    }

    Logger.error('Failed to import category {0}: [{1}] {2}', sfccCategory.id, httpClient.statusCode, httpClient.text);
    return false;
}

/**
 * Imports all transformed SFCC categories via OCAPI in sorted order.
 * Parents must come before children (handled by transformAll sorting).
 * 
 * @param {Array} sfccCategories - sorted transformed categories
 * @param {String} catalogId
 * @returns {Object} { success: Number, failed: Number, errors: Array }
 */
function importAllCategories(sfccCategories, catalogId) {
    var token = getOCAPIToken();
    if (!token) return { success: 0, failed: sfccCategories.length, errors: ['Auth failed'] };

    var instanceHost = 'zzkc-002.dx.commercecloud.salesforce.com'; // ← replace with your actual host from dw.json

    var results = { success: 0, failed: 0, errors: [] };

    sfccCategories.forEach(function (cat) {
        var ok = importCategory(token, catalogId, cat, instanceHost);
        if (ok) {
            results.success++;
        } else {
            results.failed++;
            results.errors.push(cat.id);
        }
    });

    return results;
}

module.exports = {
    importAllCategories: importAllCategories
};