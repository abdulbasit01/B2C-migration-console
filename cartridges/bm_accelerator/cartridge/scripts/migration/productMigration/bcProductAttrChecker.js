'use strict';

var runner    = require('*/cartridge/scripts/migration/core/attrPreflightRunner');
var nativeMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');

var BC_ATTR_GROUP_ID   = 'BigCommerceMigration';
var BC_ATTR_GROUP_NAME = 'BigCommerce Migration';

function toSfccOptionId(optionName) {
    return 'bc_' + String(optionName || '').replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * @returns {Array<{ name: string, sfccId: string, label: string, ctpType: string, sourceKey: string }>}
 */
function getBcVariantOptionFields() {
    var fetcher  = require('*/cartridge/scripts/migration/productMigration/bcProductFetcher');
    var seen     = {};
    var fields   = [];
    var pageSize = 25;
    var maxPages = 8;
    var offset   = 0;
    var total    = Infinity;
    var pages    = 0;

    while (offset < total && pages < maxPages) {
        var batch    = fetcher.fetchBatch(offset, pageSize);
        var products = batch.results || [];
        total = batch.total || 0;

        var pi;
        for (pi = 0; pi < products.length; pi++) {
            var variants = products[pi].variants || [];
            var vi;
            for (vi = 0; vi < variants.length; vi++) {
                var opts = variants[vi].option_values || [];
                var oi;
                for (oi = 0; oi < opts.length; oi++) {
                    var optName = opts[oi] && opts[oi].option_display_name
                        ? String(opts[oi].option_display_name).trim()
                        : '';
                    if (!optName || seen[optName]) continue;
                    seen[optName] = true;

                    var rule   = nativeMap.getRule('bigcommerce', 'Product', optName);
                    var sfccId = (rule && rule.action === 'custom_attr') ? rule.sfccField : toSfccOptionId(optName);

                    fields.push({
                        name:      optName,
                        sourceKey: optName,
                        sfccId:    sfccId,
                        label:     optName,
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
    var fields = nativeMap.getMappedSourceFields('bigcommerce', 'Product');
    var i;
    try {
        var optionFields = getBcVariantOptionFields();
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
    return runner.createDefinitions('Product', BC_ATTR_GROUP_ID, BC_ATTR_GROUP_NAME, attrs);
}

module.exports = {
    checkMissingAttributes:   checkMissingAttributes,
    createAttributes:         createAttributes,
    getBcVariantOptionFields: getBcVariantOptionFields,
    toSfccOptionId:           toSfccOptionId
};
