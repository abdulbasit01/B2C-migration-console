'use strict';

var sfccClient     = require('*/cartridge/scripts/migration/sfccClient');
var attrBuilder    = require('*/cartridge/scripts/migration/core/attrBuilder');
var nativeFieldMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');

// Shopify customer fields with no standard SFCC equivalent — each maps to a
// custom attribute created/populated on the SFCC Profile system object.
var SHOPIFY_BUILTIN_FIELDS = [
    { id: 'shopify_customer_id',       label: 'Shopify Customer ID',       sfccType: 'string'  },
    { id: 'shopify_phone',              label: 'Shopify Phone',             sfccType: 'string'  },
    { id: 'shopify_note',               label: 'Shopify Note',              sfccType: 'text'    },
    { id: 'shopify_tags',               label: 'Shopify Tags',              sfccType: 'set_of_string' },
    { id: 'shopify_verified_email',     label: 'Shopify Verified Email',    sfccType: 'boolean' },
    { id: 'shopify_accepts_marketing',  label: 'Shopify Accepts Marketing', sfccType: 'boolean' },
    { id: 'shopify_orders_count',       label: 'Shopify Orders Count',      sfccType: 'int'     },
    { id: 'shopify_total_spent',        label: 'Shopify Total Spent',       sfccType: 'string'  }
];

var SHOPIFY_ATTR_GROUP_ID   = 'ShopifyMigration';
var SHOPIFY_ATTR_GROUP_NAME = 'Shopify Migration';

/**
 * Compare the fixed Shopify customer field list against SFCC Profile attribute
 * definitions. Returns fields missing in SFCC.
 * @returns {Array} [{ id, label, sfccType, sfccNativeField, sfccNativeNote, sfccNativeAction }]
 */
function checkMissingAttributes() {
    var sfccToken    = sfccClient.getSFCCToken();
    var profileAttrs = sfccClient.getAttributeDefinitions(sfccToken, 'Profile');
    var customerAttrs = sfccClient.getAttributeDefinitions(sfccToken, 'Customer');
    var sysAttrs     = profileAttrs.concat(customerAttrs); // Customer + Profile — customer-related native fields span both
    var existingIds  = {};
    for (var pa = 0; pa < profileAttrs.length; pa++) existingIds[profileAttrs[pa].id] = true;

    try { sfccClient.ensureAttributeGroup(sfccToken, 'Profile', SHOPIFY_ATTR_GROUP_ID, SHOPIFY_ATTR_GROUP_NAME); } catch (ge) {}

    var missing = [];
    for (var i = 0; i < SHOPIFY_BUILTIN_FIELDS.length; i++) {
        var f = SHOPIFY_BUILTIN_FIELDS[i];
        if (!existingIds[f.id]) {
            var entry = { id: f.id, label: f.label, sfccType: f.sfccType };
            var rule  = nativeFieldMap.getEffectiveRule('shopify', 'Customer', f.id, f.label, sysAttrs);
            if (rule) {
                entry.sfccNativeField  = rule.sfccField;
                entry.sfccNativeNote   = rule.note;
                entry.sfccNativeAction = rule.action;
            }
            missing.push(entry);
        } else {
            try { sfccClient.addAttributeToGroup(sfccToken, 'Profile', SHOPIFY_ATTR_GROUP_ID, f.id); } catch (age) {}
        }
    }
    return missing;
}

/**
 * Create the given attribute definitions on the SFCC Profile system object
 * and assign each to the "Shopify Migration" attribute group.
 * @param {Array} attrs - [{ id, label, sfccType }]
 * @returns {{ created: number, failed: number, errors: Array }}
 */
function createAttributes(attrs) {
    var sfccToken = sfccClient.getSFCCToken();
    var created   = 0;
    var failed    = 0;
    var errors    = [];

    try { sfccClient.ensureAttributeGroup(sfccToken, 'Profile', SHOPIFY_ATTR_GROUP_ID, SHOPIFY_ATTR_GROUP_NAME); } catch (ge) {}

    for (var i = 0; i < attrs.length; i++) {
        var attr = attrs[i];
        try {
            var def = attrBuilder.buildAttrDefinition(
                attr.id,
                attr.sfccType || 'string',
                attr.label    || attr.id
            );
            sfccClient.createAttributeDefinition(sfccToken, 'Profile', def);
            sfccClient.addAttributeToGroup(sfccToken, 'Profile', SHOPIFY_ATTR_GROUP_ID, attr.id);
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
    createAttributes:       createAttributes,
    SHOPIFY_BUILTIN_FIELDS: SHOPIFY_BUILTIN_FIELDS
};
