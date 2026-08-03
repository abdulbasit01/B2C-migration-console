'use strict';

var sfccClient = require('*/cartridge/scripts/migration/sfccClient');
var runner     = require('*/cartridge/scripts/migration/core/attrPreflightRunner');
var nativeMap  = require('*/cartridge/scripts/migration/config/nativeFieldMap');

var BC_ATTR_GROUP_ID   = 'BigCommerceMigration';
var BC_ATTR_GROUP_NAME = 'BigCommerce Migration';

var BC_BUILTIN_FIELDS = [
    { id: 'bc_product_id', label: 'BigCommerce Product ID', sfccType: 'string' },
    { id: 'bc_sku',        label: 'BigCommerce SKU',        sfccType: 'string' },
    { id: 'bc_status',     label: 'BigCommerce Status',     sfccType: 'string' }
];

function toSfccOptionId(optionName) {
    return 'bc_' + String(optionName || '').replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Discover BigCommerce variant option names from a sample of products.
 * @returns {Array<{ name: string, sfccId: string, label: string, ctpType: string }>}
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
                        name:    optName,
                        sfccId:  sfccId,
                        label:   optName,
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
 * Compare required BigCommerce tracking (+ discovered option) attributes against SFCC.
 * @returns {Array} [{ id, label, sfccType, ctpType }]
 */
function checkMissingAttributes() {
    var attrIdMapSession = require('*/cartridge/scripts/migration/core/attrIdMapSession');
    var attrMap     = attrIdMapSession.read('product');
    var sfccToken   = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(sfccToken, 'Product');

    try { sfccClient.ensureAttributeGroup(sfccToken, 'Product', BC_ATTR_GROUP_ID, BC_ATTR_GROUP_NAME); } catch (ge) {}

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
                sfccClient.addAttributeToGroup(sfccToken, 'Product', BC_ATTR_GROUP_ID, resolved);
            } catch (age) {}
        }
    }

    for (i = 0; i < BC_BUILTIN_FIELDS.length; i++) {
        var bf = BC_BUILTIN_FIELDS[i];
        consider(bf.id, bf.label, bf.sfccType, 'String');
    }

    try {
        var optionFields = getBcVariantOptionFields();
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
    return runner.createDefinitions('Product', BC_ATTR_GROUP_ID, BC_ATTR_GROUP_NAME, attrs);
}

module.exports = {
    checkMissingAttributes:  checkMissingAttributes,
    createAttributes:        createAttributes,
    getBcVariantOptionFields: getBcVariantOptionFields,
    toSfccOptionId:          toSfccOptionId,
    BC_BUILTIN_FIELDS:       BC_BUILTIN_FIELDS
};
