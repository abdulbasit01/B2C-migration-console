'use strict';

/* global request */

var log = require('*/cartridge/scripts/migration/core/migrationLogger').catalog;
var serviceHttp = require('*/cartridge/scripts/migration/core/serviceHttp');
var cfg = require('*/cartridge/scripts/migration/configAccessor');

/**
 * Gets OCAPI Data API token via BM user-grant (sfccClient).
 * @returns {string|null}
 */
function getOCAPIToken() {
    try {
        return require('*/cartridge/scripts/migration/sfccClient').getSFCCToken();
    } catch (e) {
        log.error('OCAPI token unavailable: configure rcMigOcapiClientId and BM credentials');
        return null;
    }
}

/**
 * Upserts a single category via OCAPI Data API.
 */
function importCategory(token, catalogId, sfccCategory, instanceHost) {
    var version = (cfg.sfcc && cfg.sfcc.metaVersion) || 'v25_6';
    var url = 'https://' + instanceHost + '/s/-/dw/data/' + version
        + '/catalogs/' + encodeURIComponent(catalogId)
        + '/categories/' + encodeURIComponent(sfccCategory.id);

    var payload = {
        id: sfccCategory.id,
        name: sfccCategory.name,
        description: sfccCategory.description,
        parent_category_id: sfccCategory.parentId,
        online: sfccCategory.online,
        position: sfccCategory.position,
        page_title: sfccCategory.pageTitle,
        page_description: sfccCategory.pageDescription,
        page_keywords: sfccCategory.pageKeywords,
        page_url: sfccCategory.pageURL
    };

    // Genuine CT custom-Type fields (merchant-defined extensions) — dynamically prefixed as c_<id>.
    var ca = sfccCategory.customAttributes || {};
    Object.keys(ca).forEach(function (key) {
        payload['c_' + key] = ca[key];
    });

    var res = serviceHttp.put('sfcc', url, {
        Authorization:  'Bearer ' + token,
        'Content-Type': 'application/json'
    }, JSON.stringify(payload));

    if (res.status === 200 || res.status === 201) {
        return true;
    }

    log.error('Failed to import category {0}: status={1}', sfccCategory.id, res.status);
    return false;
}

/**
 * Imports all transformed SFCC categories via OCAPI in sorted order.
 */
function importAllCategories(sfccCategories, catalogId) {
    var token = getOCAPIToken();
    if (!token) return { success: 0, failed: sfccCategories.length, errors: ['Auth failed'] };

    var instanceHost = request.httpHost;

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
