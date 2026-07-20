'use strict';

var sfccClient  = require('*/cartridge/scripts/migration/sfccClient');
var runner      = require('*/cartridge/scripts/migration/core/attrPreflightRunner');

var SHOPIFY_ATTR_GROUP_ID   = 'ShopifyMigration';
var SHOPIFY_ATTR_GROUP_NAME = 'Shopify Migration';

// Tracking attributes always required for Shopify product migration.
var SHOPIFY_BUILTIN_FIELDS = [
    { id: 'shopify_product_id', label: 'Shopify Product ID', sfccType: 'string' },
    { id: 'shopify_handle',     label: 'Shopify Handle',     sfccType: 'string' },
    { id: 'shopify_status',     label: 'Shopify Status',     sfccType: 'string' }
];

function toSfccOptionId(optionName) {
    return 'shopify_' + String(optionName || '').replace(/[^a-zA-Z0-9_]/g, '_');
}

function isSkippableOptionName(name) {
    var n = String(name || '').trim().toLowerCase();
    return !n || n === 'title';
}

/**
 * Discover Shopify variant option names from a sample of products.
 * @returns {Array<{ name: string, sfccId: string, label: string, ctpType: string }>}
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
                    fields.push({
                        name:    optName,
                        sfccId:  toSfccOptionId(optName),
                        label:   optName,
                        ctpType: 'String'
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
 * Compare required Shopify tracking (+ discovered option) attributes against SFCC.
 * @returns {Array} [{ id, label, sfccType, ctpType }]
 */
function checkMissingAttributes() {
    var attrIdMapSession = require('*/cartridge/scripts/migration/core/attrIdMapSession');
    var attrMap     = attrIdMapSession.read('product');
    var sfccToken   = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(sfccToken, 'Product');

    try { sfccClient.ensureAttributeGroup(sfccToken, 'Product', SHOPIFY_ATTR_GROUP_ID, SHOPIFY_ATTR_GROUP_NAME); } catch (ge) {}

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
                sfccClient.addAttributeToGroup(sfccToken, 'Product', SHOPIFY_ATTR_GROUP_ID, resolved);
            } catch (age) {}
        }
    }

    for (i = 0; i < SHOPIFY_BUILTIN_FIELDS.length; i++) {
        var bf = SHOPIFY_BUILTIN_FIELDS[i];
        consider(bf.id, bf.label, bf.sfccType, 'String');
    }

    try {
        var optionFields = getShopifyVariantOptionFields();
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
    return runner.createDefinitions('Product', SHOPIFY_ATTR_GROUP_ID, SHOPIFY_ATTR_GROUP_NAME, attrs);
}

module.exports = {
    checkMissingAttributes:       checkMissingAttributes,
    createAttributes:             createAttributes,
    getShopifyVariantOptionFields: getShopifyVariantOptionFields,
    toSfccOptionId:               toSfccOptionId,
    SHOPIFY_BUILTIN_FIELDS:       SHOPIFY_BUILTIN_FIELDS
};
