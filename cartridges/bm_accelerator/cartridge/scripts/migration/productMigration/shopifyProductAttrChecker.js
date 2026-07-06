'use strict';

var sfccClient  = require('*/cartridge/scripts/migration/sfccClient');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');

var SHOPIFY_ATTR_GROUP_ID   = 'ShopifyMigration';
var SHOPIFY_ATTR_GROUP_NAME = 'Shopify Migration';

// Tracking attributes always required for Shopify product migration.
var SHOPIFY_BUILTIN_FIELDS = [
    { id: 'shopify_product_id', label: 'Shopify Product ID', sfccType: 'string' },
    { id: 'shopify_handle',     label: 'Shopify Handle',     sfccType: 'string' },
    { id: 'shopify_status',     label: 'Shopify Status',     sfccType: 'string' }
];

/**
 * Compare required Shopify tracking attributes against SFCC Product attribute definitions.
 * Returns attributes missing in SFCC.
 * @returns {Array} [{ id, label, sfccType, ctpType }]
 */
function checkMissingAttributes() {
    var sfccToken   = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(sfccToken, 'Product');

    try { sfccClient.ensureAttributeGroup(sfccToken, 'Product', SHOPIFY_ATTR_GROUP_ID, SHOPIFY_ATTR_GROUP_NAME); } catch (ge) {}

    var missing = [];
    for (var i = 0; i < SHOPIFY_BUILTIN_FIELDS.length; i++) {
        var bf = SHOPIFY_BUILTIN_FIELDS[i];
        if (!existingIds[bf.id]) {
            missing.push({ id: bf.id, label: bf.label, sfccType: bf.sfccType, ctpType: 'String' });
        } else {
            try { sfccClient.addAttributeToGroup(sfccToken, 'Product', SHOPIFY_ATTR_GROUP_ID, bf.id); } catch (age) {}
        }
    }
    return missing;
}

/**
 * Create the given attribute definitions on the SFCC Product system object
 * and assign each to the "Shopify Migration" attribute group.
 * @param {Array} attrs - [{ id, label, sfccType }]
 * @returns {{ created: number, failed: number, errors: Array }}
 */
function createAttributes(attrs) {
    var sfccToken = sfccClient.getSFCCToken();
    var created   = 0;
    var failed    = 0;
    var errors    = [];

    try { sfccClient.ensureAttributeGroup(sfccToken, 'Product', SHOPIFY_ATTR_GROUP_ID, SHOPIFY_ATTR_GROUP_NAME); } catch (ge) {}

    for (var i = 0; i < attrs.length; i++) {
        var attr = attrs[i];
        try {
            var def = attrBuilder.buildAttrDefinition(attr.id, attr.sfccType || 'string', attr.label || attr.id);
            sfccClient.createAttributeDefinition(sfccToken, 'Product', def);
            sfccClient.addAttributeToGroup(sfccToken, 'Product', SHOPIFY_ATTR_GROUP_ID, attr.id);
            created++;
        } catch (e) {
            failed++;
            if (errors.length < 5) errors.push(attr.id + ': ' + (e.message || String(e)));
        }
    }
    return { created: created, failed: failed, errors: errors };
}

module.exports = {
    checkMissingAttributes: checkMissingAttributes,
    createAttributes:       createAttributes
};
