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
var CTP_ATTR_GROUP_NAME      = 'CT Migration';
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
    { id: 'ctSlug',     label: 'CT Category Slug',     sfccType: 'string' },
    { id: 'ctPosition', label: 'CT Category Position', sfccType: 'double' }
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
 * Check category attributes: system-field maps + required custom attrs.
 * @param {string} platform  'shopify' | 'commercetools' | 'sap' | 'bigcommerce'
 * @returns {{ mapped: Array, missing: Array, attrs: Array }}
 */
function checkAttributes(platform) {
    var runner    = require('*/cartridge/scripts/migration/core/attrPreflightRunner');
    var nativeMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');
    var mapPlatform = platform === 'commercetools' ? 'commercetools' : platform;
    var fields = nativeMap.getMappedSourceFields(mapPlatform, 'Category');
    var required = getRequiredAttrs(platform);
    var i;
    for (i = 0; i < required.length; i++) {
        fields.push({
            name: required[i].id,
            sourceKey: required[i].id,
            sfccId: required[i].id,
            label: required[i].label,
            ctpType: 'String',
            sfccType: required[i].sfccType
        });
    }

    var classified = runner.classifyFields({
        sfccObjectType: 'Category',
        taskName:       'Category',
        moduleKey:      'category',
        fields:         fields
    });

    // Legacy shape for categoryMigration.isml (attrs with exists flag)
    var attrs = [];
    for (i = 0; i < classified.mapped.length; i++) {
        attrs.push({
            id: classified.mapped[i].id,
            label: classified.mapped[i].label,
            sfccType: 'string',
            exists: true,
            sfccField: classified.mapped[i].sfccField,
            sfccTypeOptions: ALL_SFCC_TYPES
        });
    }
    for (i = 0; i < classified.missing.length; i++) {
        attrs.push({
            id: classified.missing[i].id,
            label: classified.missing[i].label,
            sfccType: classified.missing[i].sfccType || 'string',
            exists: false,
            sfccTypeOptions: classified.missing[i].sfccTypeOptions || ALL_SFCC_TYPES
        });
    }

    return {
        mapped:  classified.mapped,
        missing: classified.missing,
        attrs:   attrs
    };
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
