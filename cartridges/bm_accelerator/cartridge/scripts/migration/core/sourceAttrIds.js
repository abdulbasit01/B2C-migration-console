'use strict';

var registry = require('*/cartridge/scripts/migration/core/dataSourceRegistry');

/**
 * Short prefix for SFCC custom attribute IDs (spy_* / sap_* / ctp_*).
 * @param {string} [platformId]
 * @returns {string}
 */
function getPrefix(platformId) {
    var id = platformId || registry.getPlatformId();
    if (id === 'shopify') return 'spy';
    if (id === 'sap')     return 'sap';
    if (id === 'bigcommerce') return 'bc';
    return 'ctp';
}

/**
 * Attribute group on SFCC system objects for migration-created attrs.
 * @param {string} [platformId]
 * @returns {{ id: string, name: string }}
 */
function getAttrGroup(platformId) {
    var id = platformId || registry.getPlatformId();
    if (id === 'shopify') {
        return { id: 'ShopifyMigration', name: 'Shopify Migration' };
    }
    if (id === 'sap') {
        return { id: 'SAPMigration', name: 'SAP Migration' };
    }
    if (id === 'bigcommerce') {
        return { id: 'BigCommerceMigration', name: 'BigCommerce Migration' };
    }
    return { id: 'CTPMigration', name: 'CTP Migration' };
}

/**
 * Build underscore-style SFCC attr id: spy_my_field / ctp_my_field / bc_my_field.
 * @param {string} fieldName
 * @param {string} [platformId]
 * @returns {string}
 */
function toAttrId(fieldName, platformId) {
    var prefix = getPrefix(platformId);
    var safe   = String(fieldName || '').replace(/[^a-zA-Z0-9_]/g, '_');
    if (/^(ctp|spy|bc|sap)_/i.test(safe)) {
        safe = safe.replace(/^(ctp|spy|bc|sap)_/i, '');
    }
    return prefix + '_' + safe;
}

/**
 * Remap camelCase trace attrs: ctpStoreId → spyStoreId / bcStoreId.
 * @param {string} id
 * @param {string} [platformId]
 * @returns {string}
 */
function remapCamelAttrId(id, platformId) {
    var str      = String(id || '');
    var platform = platformId || registry.getPlatformId();
    if (platform === 'shopify' && str.indexOf('ctp') === 0) {
        return 'spy' + str.substring(3);
    }
    if (platform === 'bigcommerce' && str.indexOf('ctp') === 0) {
        return 'bc' + str.substring(3);
    }
    if (platform === 'bigcommerce' && str.indexOf('spy') === 0) {
        return 'bc' + str.substring(3);
    }
    if (platform === 'commercetools' && str.indexOf('spy') === 0) {
        return 'ctp' + str.substring(3);
    }
    return str;
}

/**
 * @param {string} suffix - e.g. StoreId, StoreKey
 * @param {string} label
 * @param {string} sourceType
 * @param {string} [platformId]
 * @returns {{ sfccId: string, label: string, sourceType: string }}
 */
function traceAttr(suffix, label, sourceType, platformId) {
    var prefix = getPrefix(platformId);
    return {
        sfccId:     prefix + suffix,
        label:      label,
        sourceType: sourceType || 'String'
    };
}

module.exports = {
    getPrefix:        getPrefix,
    getAttrGroup:     getAttrGroup,
    toAttrId:         toAttrId,
    remapCamelAttrId: remapCamelAttrId,
    traceAttr:        traceAttr
};
