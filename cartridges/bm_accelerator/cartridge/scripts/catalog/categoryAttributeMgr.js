'use strict';
/**
 * Manages custom attribute definitions on the SFCC Category system object.
 * Uses OCAPI (sfccClient) — NOT the deprecated DW Script ObjectAttributeDefinition API.
 * Attributes are platform-specific: Shopify gets level/isLeaf, CT gets ctId/ctSlug/ctPosition.
 */
var sfccClient  = require('*/cartridge/scripts/migration/sfccClient');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');

var CATEGORY_OBJECT          = 'Category';
var CTP_ATTR_GROUP_ID        = 'CTPMigration';
var CTP_ATTR_GROUP_NAME      = 'CTP Migration';
var SHOPIFY_ATTR_GROUP_ID    = 'ShopifyMigration';
var SHOPIFY_ATTR_GROUP_NAME  = 'Shopify Migration';
var SAP_ATTR_GROUP_ID        = 'SAPMigration';
var SAP_ATTR_GROUP_NAME      = 'SAP Migration';

var ALL_SFCC_TYPES = [
    { value: 'string',   label: 'String'   },
    { value: 'text',     label: 'Text'     },
    { value: 'html',     label: 'HTML'     },
    { value: 'int',      label: 'Integer'  },
    { value: 'double',   label: 'Double'   },
    { value: 'boolean',  label: 'Boolean'  },
    { value: 'date',     label: 'Date'     },
    { value: 'datetime', label: 'DateTime' },
    { value: 'email',    label: 'Email'    }
];

var SHOPIFY_ATTRS = [
    { id: 'level',  label: 'Category Level',   sfccType: 'int'     },
    { id: 'isLeaf', label: 'Category Is Leaf', sfccType: 'boolean' }
];

var CT_ATTRS = [
    { id: 'ctSlug',     label: 'CTP Category Slug',     sfccType: 'string' },
    { id: 'ctPosition', label: 'CTP Category Position', sfccType: 'double' }
];

var SAP_ATTRS = [
    { id: 'sapCode', label: 'SAP Category Code', sfccType: 'string' }
];

function getRequiredAttrs(platform) {
    if (platform === 'shopify') return SHOPIFY_ATTRS;
    if (platform === 'sap')     return SAP_ATTRS;
    return CT_ATTRS;
}

function getAttrGroup(platform) {
    if (platform === 'shopify') return { id: SHOPIFY_ATTR_GROUP_ID, name: SHOPIFY_ATTR_GROUP_NAME };
    if (platform === 'sap')     return { id: SAP_ATTR_GROUP_ID,     name: SAP_ATTR_GROUP_NAME };
    return { id: CTP_ATTR_GROUP_ID, name: CTP_ATTR_GROUP_NAME };
}

/**
 * Check which required category attributes are missing in SFCC.
 * @param {string} platform  'shopify' | 'commercetools'
 * @returns {Array} [{ id, label, sfccType, exists: bool }]
 */
function checkAttributes(platform) {
    var attrs       = getRequiredAttrs(platform);
    var group       = getAttrGroup(platform);
    var token       = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(token, CATEGORY_OBJECT);

    try { sfccClient.ensureAttributeGroup(token, CATEGORY_OBJECT, group.id, group.name); } catch (ge) {}

    var results = [];
    for (var i = 0; i < attrs.length; i++) {
        var a      = attrs[i];
        var exists = !!existingIds[a.id];
        try { sfccClient.addAttributeToGroup(token, CATEGORY_OBJECT, group.id, a.id); } catch (age) {}
        results.push({ id: a.id, label: a.label, sfccType: a.sfccType, exists: exists, sfccTypeOptions: ALL_SFCC_TYPES });
    }
    return results;
}

/**
 * Create all missing required category attributes on the SFCC Category system object.
 * @param {string} platform  'shopify' | 'commercetools'
 * @returns {{ created: number, skipped: number, failed: number, errors: Array }}
 */
function createMissingAttributes(platform) {
    var attrs       = getRequiredAttrs(platform);
    var group       = getAttrGroup(platform);
    var token       = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(token, CATEGORY_OBJECT);

    var created = 0;
    var skipped = 0;
    var failed  = 0;
    var errors  = [];

    try { sfccClient.ensureAttributeGroup(token, CATEGORY_OBJECT, group.id, group.name); } catch (ge) {}

    for (var i = 0; i < attrs.length; i++) {
        var a = attrs[i];
        if (existingIds[a.id]) {
            skipped++;
            try { sfccClient.addAttributeToGroup(token, CATEGORY_OBJECT, group.id, a.id); } catch (age) {}
            continue;
        }
        try {
            var def = attrBuilder.buildAttrDefinition(a.id, a.sfccType, a.label);
            sfccClient.createAttributeDefinition(token, CATEGORY_OBJECT, def);
            sfccClient.addAttributeToGroup(token, CATEGORY_OBJECT, group.id, a.id);
            created++;
        } catch (e) {
            failed++;
            if (errors.length < 5) errors.push(a.id + ': ' + (e.message || String(e)));
        }
    }

    return { created: created, skipped: skipped, failed: failed, errors: errors };
}

/**
 * Create the given attribute definitions on the SFCC Category system object.
 * @param {Array}  attrs    - [{ id, label, sfccType }]
 * @param {string} platform - 'shopify' | 'commercetools'
 * @returns {{ created: number, failed: number, errors: Array }}
 */
function createAttributes(attrs, platform) {
    var group   = getAttrGroup(platform || 'commercetools');
    var token   = sfccClient.getSFCCToken();
    var created = 0;
    var failed  = 0;
    var errors  = [];

    try { sfccClient.ensureAttributeGroup(token, CATEGORY_OBJECT, group.id, group.name); } catch (ge) {}

    for (var i = 0; i < attrs.length; i++) {
        var attr = attrs[i];
        var createOk = false;
        try {
            if (attr.originalId && attr.originalId !== attr.id) {
                try { sfccClient.deleteAttributeDefinition(token, CATEGORY_OBJECT, attr.originalId); } catch (de) {}
            }
            var def = attrBuilder.buildAttrDefinition(attr.id, attr.sfccType || 'string', attr.label || attr.id);
            sfccClient.createAttributeDefinition(token, CATEGORY_OBJECT, def);
            createOk = true;
            created++;
        } catch (e) {
            failed++;
            if (errors.length < 5) errors.push(attr.id + ': ' + (e.message || String(e)));
        }
        try { sfccClient.addAttributeToGroup(token, CATEGORY_OBJECT, group.id, attr.id); } catch (age) {}
    }
    return { created: created, failed: failed, errors: errors };
}

/**
 * Delete a single category attribute definition from SFCC.
 * @param {string} attrId
 */
function deleteAttribute(attrId) {
    var token = sfccClient.getSFCCToken();
    sfccClient.deleteAttributeDefinition(token, CATEGORY_OBJECT, attrId);
}

module.exports = {
    SHOPIFY_ATTRS           : SHOPIFY_ATTRS,
    CT_ATTRS                : CT_ATTRS,
    SAP_ATTRS               : SAP_ATTRS,
    getRequiredAttrs        : getRequiredAttrs,
    getAttrGroup            : getAttrGroup,
    checkAttributes         : checkAttributes,
    createAttributes        : createAttributes,
    createMissingAttributes : createMissingAttributes,
    deleteAttribute         : deleteAttribute
};
