'use strict';

var MIGRATION_BASE = 'src/migration';

/** @type {Object.<string, string>} */
var MODULE_IDS = {
    customer:       'customer',
    product:        'product',
    order:          'order',
    catalog:        'catalog',
    shippingMethod: 'shipping-method',
    inventory:      'inventory',
    pricebook:      'pricebook',
    tax:            'tax',
    store:          'store'
};

/**
 * @param {string} moduleKey - key in MODULE_IDS
 * @returns {string} e.g. src/migration/customer
 */
function getRelativePath(moduleKey) {
    var moduleId = MODULE_IDS[moduleKey];
    if (!moduleId) {
        throw new Error('Unknown migration module: ' + moduleKey);
    }
    return MIGRATION_BASE + '/' + moduleId;
}

/**
 * @param {Date} [date]
 * @returns {string} e.g. 20250630
 */
function formatRunDate(date) {
    var d = date || new Date();
    function pad(n) {
        return (n < 10 ? '0' : '') + n;
    }
    return String(d.getFullYear())
        + pad(d.getMonth() + 1)
        + pad(d.getDate());
}

/**
 * @param {string} moduleKey
 * @param {string} runDate - YYYYMMDD
 * @param {number} versionNumber - 1-based (v001 = 1)
 * @param {string} [prefix] - source-platform prefix, e.g. 'ctp' or 'shp'
 * @returns {string} e.g. customer-20250630-v001.xml or ctp_product-20250630-v001.xml
 */
function buildXmlFileName(moduleKey, runDate, versionNumber, prefix) {
    var moduleId = MODULE_IDS[moduleKey];
    if (!moduleId) {
        throw new Error('Unknown migration module: ' + moduleKey);
    }
    var version = String(versionNumber || 1);
    while (version.length < 3) {
        version = '0' + version;
    }
    var namePrefix = prefix ? (String(prefix) + '_') : '';
    return namePrefix + moduleId + '-' + runDate + '-v' + version + '.xml';
}

module.exports = {
    MIGRATION_BASE:     MIGRATION_BASE,
    MODULE_IDS:         MODULE_IDS,
    getRelativePath:    getRelativePath,
    formatRunDate:      formatRunDate,
    buildXmlFileName:   buildXmlFileName
};
