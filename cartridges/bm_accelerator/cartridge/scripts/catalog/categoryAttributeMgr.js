'use strict';
/**
 * Manages CTP-specific custom attribute definitions on the SFCC Category system object.
 * Uses OCAPI (sfccClient) — NOT the deprecated DW Script ObjectAttributeDefinition API.
 */
var sfccClient  = require('*/cartridge/scripts/migration/sfccClient');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');

var CATEGORY_OBJECT     = 'Category';
var CTP_ATTR_GROUP_ID   = 'CTPMigration';
var CTP_ATTR_GROUP_NAME = 'CTP Migration';

// Fixed custom attributes required on the SFCC Category system object
// to preserve CTP category metadata after migration.
var REQUIRED_ATTRS = [
    { id: 'ctId',       label: 'CTP Category ID',       sfccType: 'string' },
    { id: 'ctSlug',     label: 'CTP Category Slug',     sfccType: 'string' },
    { id: 'ctPosition', label: 'CTP Category Position', sfccType: 'double'    }
];

/**
 * Check which required category attributes are missing in SFCC.
 * @returns {Array} [{ id, label, sfccType, exists: bool }]
 */
function checkAttributes() {
    var token       = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(token, CATEGORY_OBJECT);

    try { sfccClient.ensureAttributeGroup(token, CATEGORY_OBJECT, CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME); } catch (ge) {}

    var results = [];
    for (var i = 0; i < REQUIRED_ATTRS.length; i++) {
        var a      = REQUIRED_ATTRS[i];
        var exists = !!existingIds[a.id];
        if (exists) {
            try { sfccClient.addAttributeToGroup(token, CATEGORY_OBJECT, CTP_ATTR_GROUP_ID, a.id); } catch (age) {}
        }
        results.push({ id: a.id, label: a.label, sfccType: a.sfccType, exists: exists });
    }
    return results;
}

/**
 * Create all missing required category attributes on the SFCC Category system object.
 * @returns {{ created: number, skipped: number, failed: number, errors: Array }}
 */
function createMissingAttributes() {
    var token       = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(token, CATEGORY_OBJECT);

    var created = 0;
    var skipped = 0;
    var failed  = 0;
    var errors  = [];

    try { sfccClient.ensureAttributeGroup(token, CATEGORY_OBJECT, CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME); } catch (ge) {}

    for (var i = 0; i < REQUIRED_ATTRS.length; i++) {
        var a = REQUIRED_ATTRS[i];
        if (existingIds[a.id]) {
            skipped++;
            try { sfccClient.addAttributeToGroup(token, CATEGORY_OBJECT, CTP_ATTR_GROUP_ID, a.id); } catch (age) {}
            continue;
        }
        try {
            var def = attrBuilder.buildAttrDefinition(a.id, a.sfccType, a.label);
            sfccClient.createAttributeDefinition(token, CATEGORY_OBJECT, def);
            sfccClient.addAttributeToGroup(token, CATEGORY_OBJECT, CTP_ATTR_GROUP_ID, a.id);
            created++;
        } catch (e) {
            failed++;
            if (errors.length < 5) errors.push(a.id + ': ' + (e.message || String(e)));
        }
    }

    return { created: created, skipped: skipped, failed: failed, errors: errors };
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
    REQUIRED_ATTRS          : REQUIRED_ATTRS,
    checkAttributes         : checkAttributes,
    createMissingAttributes : createMissingAttributes,
    deleteAttribute         : deleteAttribute
};
