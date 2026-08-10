'use strict';

var runner    = require('*/cartridge/scripts/migration/core/attrPreflightRunner');
var nativeMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');

var SHOPIFY_ATTR_GROUP_ID   = 'ShopifyMigration';
var SHOPIFY_ATTR_GROUP_NAME = 'Shopify Migration';

function toSfccOptionId(optionName) {
    return 'shopify_' + String(optionName || '').replace(/[^a-zA-Z0-9_]/g, '_');
}

function isSkippableOptionName(name) {
    var n = String(name || '').trim().toLowerCase();
    return !n || n === 'title';
}

/**
 * Discover Shopify variant option names from a sample of products.
 * @returns {Array<{ name: string, sfccId: string, label: string, ctpType: string, sourceKey: string }>}
 */
function getShopifyVariantOptionFields() {
    var fetcher = require('*/cartridge/scripts/migration/productMigration/shopifyProductFetcher');
    var seen    = {};
    var fields  = [];
    var cursor  = null;
    var pages   = 0;
    var maxPages = 8;

    do {
        var batch = fetcher.fetchBatch(cursor, 25);
        var nodes = batch.results || [];
        var ni;
        for (ni = 0; ni < nodes.length; ni++) {
            var variants = (nodes[ni].variants && nodes[ni].variants.nodes) || [];
            var vi;
            for (vi = 0; vi < variants.length; vi++) {
                var opts = variants[vi].selectedOptions || [];
                var oi;
                for (oi = 0; oi < opts.length; oi++) {
                    var optName = opts[oi] && opts[oi].name ? String(opts[oi].name).trim() : '';
                    if (isSkippableOptionName(optName)) continue;
                    if (opts[oi].value === 'Default Title') continue;
                    if (seen[optName]) continue;
                    seen[optName] = true;
                    var rule = nativeMap.getRule('shopify', 'Product', optName);
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
        cursor = batch.nextCursor;
        pages++;
    } while (batch.hasMore && pages < maxPages);

    fields.sort(function (a, b) {
        return String(a.name).localeCompare(String(b.name));
    });
    return fields;
}

/**
 * @returns {{ mapped: Array, missing: Array, coveragePending: Array, skipped: Array }}
 */
function checkMissingAttributes() {
    var fields = nativeMap.getMappedSourceFields('shopify', 'Product');
    var i;
    try {
        var optionFields = getShopifyVariantOptionFields();
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
    return runner.createDefinitions('Product', SHOPIFY_ATTR_GROUP_ID, SHOPIFY_ATTR_GROUP_NAME, attrs);
}

module.exports = {
    checkMissingAttributes:        checkMissingAttributes,
    createAttributes:              createAttributes,
    getShopifyVariantOptionFields: getShopifyVariantOptionFields,
    toSfccOptionId:                toSfccOptionId
};
