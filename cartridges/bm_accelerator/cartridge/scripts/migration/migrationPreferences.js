'use strict';

/**
 * Site preference helpers for B2C Migration Console.
 * Preferences are the sole runtime source of migration credentials (LINK standard).
 */

var Site = require('dw/system/Site');

/**
 * @param {string} id
 * @param {*} [fallback]
 * @returns {*}
 */
function getPref(id, fallback) {
    try {
        var site = Site.getCurrent();
        if (!site) return fallback;
        var val = site.getCustomPreferenceValue(id);
        if (val === null || val === undefined || val === '') {
            return fallback;
        }
        return val;
    } catch (e) {
        return fallback;
    }
}

/**
 * Overlay preference values onto a shallow-cloned config object.
 * @param {Object} cfg
 * @returns {Object}
 */
function applyToConfig(cfg) {
    var out = cfg || {};

    out.shopify = out.shopify || {};
    out.ctp = out.ctp || {};
    out.sap = out.sap || {};
    out.sfcc = out.sfcc || {};

    out.shopify.storeUrl     = getPref('rcMigShopifyStoreUrl', out.shopify.storeUrl || '');
    out.shopify.clientId     = getPref('rcMigShopifyClientId', out.shopify.clientId || '');
    out.shopify.clientSecret = getPref('rcMigShopifyClientSecret', out.shopify.clientSecret || '');
    out.shopify.apiVersion   = getPref('rcMigShopifyApiVersion', out.shopify.apiVersion || '2025-01');

    out.ctp.projectKey   = getPref('rcMigCtpProjectKey', out.ctp.projectKey || '');
    out.ctp.clientId     = getPref('rcMigCtpClientId', out.ctp.clientId || '');
    out.ctp.clientSecret = getPref('rcMigCtpClientSecret', out.ctp.clientSecret || '');
    out.ctp.authUrl      = getPref('rcMigCtpAuthUrl', out.ctp.authUrl || 'https://auth.us-central1.gcp.commercetools.com');
    out.ctp.apiUrl       = getPref('rcMigCtpApiUrl', out.ctp.apiUrl || 'https://api.us-central1.gcp.commercetools.com');

    out.sap.baseUrl      = getPref('rcMigSapBaseUrl', out.sap.baseUrl || '');
    out.sap.baseSite     = getPref('rcMigSapBaseSite', out.sap.baseSite || '');
    out.sap.clientId     = getPref('rcMigSapClientId', out.sap.clientId || '');
    out.sap.clientSecret = getPref('rcMigSapClientSecret', out.sap.clientSecret || '');

    out.sfcc.bmClientId = getPref('rcMigOcapiClientId', out.sfcc.bmClientId || '');
    out.sfcc.metaVersion = getPref('rcMigOcapiVersion', out.sfcc.metaVersion || 'v25_6');
    out.sfcc.version     = out.sfcc.metaVersion;
    // catalogId / inventoryListId / customerListId stay from defaults or wizard UI

    return out;
}

/**
 * BM credentials from site prefs.
 * @returns {{ bmUsername: string, bmPassword: string }}
 */
function getBmCredentials() {
    return {
        bmUsername: getPref('rcMigBmUsername', ''),
        bmPassword: getPref('rcMigBmPassword', '')
    };
}

module.exports = {
    getPref:          getPref,
    applyToConfig:    applyToConfig,
    getBmCredentials: getBmCredentials
};
