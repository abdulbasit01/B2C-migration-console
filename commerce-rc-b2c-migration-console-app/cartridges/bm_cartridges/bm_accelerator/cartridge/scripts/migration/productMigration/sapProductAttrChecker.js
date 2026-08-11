'use strict';

var runner    = require('*/cartridge/scripts/migration/core/attrPreflightRunner');
var nativeMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');

var SAP_ATTR_GROUP_ID   = 'SAPMigration';
var SAP_ATTR_GROUP_NAME = 'SAP Migration';

function toSfccOptionId(qualifierName) {
    return 'sap_' + String(qualifierName || '').replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * @returns {Array<{ name: string, sfccId: string, label: string, ctpType: string, sourceKey: string }>}
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
                        name:      qName,
                        sourceKey: qName,
                        sfccId:    sfccId,
                        label:     qName,
                        ctpType:   'String'
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
 * @returns {{ mapped: Array, missing: Array, coveragePending: Array, skipped: Array }}
 */
function checkMissingAttributes() {
    var fields = nativeMap.getMappedSourceFields('sap', 'Product');
    var i;
    try {
        var optionFields = getSapVariantOptionFields();
        for (i = 0; i < optionFields.length; i++) {
            fields.push(optionFields[i]);
        }
    } catch (oe) { /* best-effort */ }

    return runner.classifyFields({
        sfccObjectType: 'Product',
        taskName:       'Product',
        moduleKey:      'product',
        fields:         fields
    });
}

function createAttributes(attrs) {
    return runner.createDefinitions('Product', SAP_ATTR_GROUP_ID, SAP_ATTR_GROUP_NAME, attrs);
}

module.exports = {
    checkMissingAttributes:    checkMissingAttributes,
    createAttributes:          createAttributes,
    getSapVariantOptionFields: getSapVariantOptionFields,
    toSfccOptionId:            toSfccOptionId
};
