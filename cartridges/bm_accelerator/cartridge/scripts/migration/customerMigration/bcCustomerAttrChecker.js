'use strict';

var sfccClient     = require('*/cartridge/scripts/migration/sfccClient');
var nativeFieldMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');

// BigCommerce customer fields with no standard SFCC equivalent — each maps to a
// custom attribute created/populated on the SFCC Profile system object.
var BC_BUILTIN_FIELDS = [
    { id: 'bc_customer_id',         label: 'BigCommerce Customer ID',         sfccType: 'string'  },
    { id: 'bc_company',             label: 'BigCommerce Company',             sfccType: 'string'  },
    { id: 'bc_notes',               label: 'BigCommerce Notes',               sfccType: 'text'    },
    { id: 'bc_customer_group_id',   label: 'BigCommerce Customer Group ID',   sfccType: 'string'  },
    { id: 'bc_tax_exempt_category', label: 'BigCommerce Tax Exempt Category', sfccType: 'string'  },
    { id: 'bc_accepts_marketing',   label: 'BigCommerce Accepts Marketing',   sfccType: 'boolean' }
];

var BC_ATTR_GROUP_ID   = 'BigCommerceMigration';
var BC_ATTR_GROUP_NAME = 'BigCommerce Migration';

/**
 * Compare the fixed BigCommerce customer field list against SFCC Profile attribute
 * definitions. Returns fields missing in SFCC.
 * @returns {Array} [{ id, label, sfccType, sfccNativeField, sfccNativeNote, sfccNativeAction }]
 */
function checkMissingAttributes() {
    var attrIdMapSession = require('*/cartridge/scripts/migration/core/attrIdMapSession');
    var attrMap       = attrIdMapSession.read('customer');
    var sfccToken     = sfccClient.getSFCCToken();
    var profileAttrs  = sfccClient.getAttributeDefinitions(sfccToken, 'Profile');
    var customerAttrs = sfccClient.getAttributeDefinitions(sfccToken, 'Customer');
    var sysAttrs      = profileAttrs.concat(customerAttrs);
    var existingIds   = {};
    for (var pa = 0; pa < profileAttrs.length; pa++) existingIds[profileAttrs[pa].id] = true;

    try { sfccClient.ensureAttributeGroup(sfccToken, 'Profile', BC_ATTR_GROUP_ID, BC_ATTR_GROUP_NAME); } catch (ge) {}

    var missing = [];
    for (var i = 0; i < BC_BUILTIN_FIELDS.length; i++) {
        var f = BC_BUILTIN_FIELDS[i];
        var resolved = attrIdMapSession.resolve(f.id, attrMap);
        if (existingIds[resolved]) {
            try { sfccClient.addAttributeToGroup(sfccToken, 'Profile', BC_ATTR_GROUP_ID, resolved); } catch (age) {}
            continue;
        }
        var rule = nativeFieldMap.getEffectiveRule('bigcommerce', 'Customer', f.id, f.label, sysAttrs);
        if (rule && rule.action === 'skip') continue;
        var entry = { id: f.id, label: f.label, sfccType: f.sfccType };
        if (rule) {
            entry.sfccNativeField  = rule.sfccField;
            entry.sfccNativeNote   = rule.note;
            entry.sfccNativeAction = rule.action;
        }
        missing.push(entry);
    }
    return missing;
}

/**
 * Create the given attribute definitions on the SFCC Profile system object
 * and assign each to the "BigCommerce Migration" attribute group.
 * @param {Array} attrs - [{ id, label, sfccType }]
 * @returns {{ created: number, failed: number, alreadyExists: number, errors: Array, mappedAttrs: Array, results: Array }}
 */
function createAttributes(attrs) {
    var runner = require('*/cartridge/scripts/migration/core/attrPreflightRunner');
    return runner.createDefinitions('Profile', BC_ATTR_GROUP_ID, BC_ATTR_GROUP_NAME, attrs);
}

module.exports = {
    checkMissingAttributes: checkMissingAttributes,
    createAttributes:       createAttributes,
    BC_BUILTIN_FIELDS:      BC_BUILTIN_FIELDS
};
