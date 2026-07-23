'use strict';

var sfccClient   = require('*/cartridge/scripts/migration/sfccClient');
var runner       = require('*/cartridge/scripts/migration/core/attrPreflightRunner');
var nativeMap    = require('*/cartridge/scripts/migration/config/nativeFieldMap');

var SAP_ATTR_GROUP_ID   = 'SAPMigration';
var SAP_ATTR_GROUP_NAME = 'SAP Migration';

// Tracking attributes always required for SAP product migration.
var SAP_BUILTIN_FIELDS = [
    { id: 'sap_product_id', label: 'SAP Product ID', sfccType: 'string' }
];

function toSfccOptionId(qualifierName) {
    return 'sap_' + String(qualifierName || '').replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Discover SAP Commerce variant option qualifier names from a sample of products.
 * @returns {Array<{ name: string, sfccId: string, label: string, ctpType: string }>}
 */
function getSapVariantOptionFields() {
    var fetcher  = require('*/cartridge/scripts/migration/productMigration/sapProductFetcher');
    var seen     = {};
    var fields   = [];
    var pageSize = 25;
    var maxPages = 8;
    var offset   = 0;
    var total    = Infinity;
    var pages    = 0;

    while (offset < total && pages < maxPages) {
        var batch = fetcher.fetchBatch(offset, pageSize);
        var products = batch.results || [];
        total = batch.total || 0;

        var pi;
        for (pi = 0; pi < products.length; pi++) {
            var variants = products[pi].variantOptions || [];
            var vi;
            for (vi = 0; vi < variants.length; vi++) {
                var qualifiers = variants[vi].variantOptionQualifiers || [];
                var qi;
                for (qi = 0; qi < qualifiers.length; qi++) {
                    var qName = qualifiers[qi] && qualifiers[qi].qualifier ? String(qualifiers[qi].qualifier).trim() : '';
                    if (!qName || seen[qName]) continue;
                    seen[qName] = true;

                    var rule   = nativeMap.getRule('sap', 'Product', qName);
                    var sfccId = (rule && rule.action === 'custom_attr') ? rule.sfccField : toSfccOptionId(qName);

                    fields.push({
                        name:    qName,
                        sfccId:  sfccId,
                        label:   qName,
                        ctpType: 'String'
                    });
                }
            }
        }

        offset += products.length;
        pages++;
        if (!products.length) break;
    }

    fields.sort(function (a, b) {
        return String(a.name).localeCompare(String(b.name));
    });
    return fields;
}

/**
 * Compare required SAP tracking (+ discovered option) attributes against SFCC.
 * @returns {Array} [{ id, label, sfccType, ctpType }]
 */
function checkMissingAttributes() {
    var attrIdMapSession = require('*/cartridge/scripts/migration/core/attrIdMapSession');
    var attrMap     = attrIdMapSession.read('product');
    var sfccToken   = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(sfccToken, 'Product');

    try { sfccClient.ensureAttributeGroup(sfccToken, 'Product', SAP_ATTR_GROUP_ID, SAP_ATTR_GROUP_NAME); } catch (ge) {}

    var missing = [];
    var seen    = {};
    var i;

    function consider(id, label, sfccType, ctpType) {
        if (!id || seen[id]) return;
        seen[id] = true;
        var resolved = attrIdMapSession.resolve(id, attrMap);
        if (!existingIds[resolved]) {
            missing.push({
                id:       id,
                label:    label || id,
                sfccType: sfccType || 'string',
                ctpType:  ctpType || 'String'
            });
        } else {
            try {
                sfccClient.addAttributeToGroup(sfccToken, 'Product', SAP_ATTR_GROUP_ID, resolved);
            } catch (age) {}
        }
    }

    for (i = 0; i < SAP_BUILTIN_FIELDS.length; i++) {
        var bf = SAP_BUILTIN_FIELDS[i];
        consider(bf.id, bf.label, bf.sfccType, 'String');
    }

    try {
        var optionFields = getSapVariantOptionFields();
        for (i = 0; i < optionFields.length; i++) {
            var of = optionFields[i];
            consider(of.sfccId, of.label, 'string', of.ctpType);
        }
    } catch (oe) {
        // Option discovery is best-effort; builtins still checked.
    }

    return missing;
}

/**
 * @param {Array} attrs
 * @returns {{ created: number, failed: number, alreadyExists: number, errors: Array, mappedAttrs: Array, results: Array }}
 */
function createAttributes(attrs) {
    return runner.createDefinitions('Product', SAP_ATTR_GROUP_ID, SAP_ATTR_GROUP_NAME, attrs);
}

module.exports = {
    checkMissingAttributes:   checkMissingAttributes,
    createAttributes:         createAttributes,
    getSapVariantOptionFields: getSapVariantOptionFields,
    toSfccOptionId:           toSfccOptionId,
    SAP_BUILTIN_FIELDS:       SAP_BUILTIN_FIELDS
};
