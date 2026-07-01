'use strict';

var typeMap     = require('*/cartridge/scripts/migration/connectors/ctp/ctpTypeMap');
var sfccClient  = require('*/cartridge/scripts/migration/sfccClient');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');

var CTP_ATTR_GROUP_ID   = 'CTPMigration';
var CTP_ATTR_GROUP_NAME = 'CTP Migration';
var SFCC_OBJECT_TYPE    = 'TaxClass';

// CTP key/name/rates map to native SFCC tax-class, tax-jurisdiction, and tax-rate XML.
// Tax categories have no CTP custom-type ResourceTypeId — nothing to sync via Types API.

/**
 * CTP does not support custom types on tax categories (no tax-category ResourceTypeId).
 * Tax migration maps name, rates, and countries to native SFCC tax XML only.
 * @returns {Array}
 */
function getCtpTaxCategoryFields() {
    return [];
}

/**
 * Compare CTP tax-category fields against SFCC TaxClass attribute definitions.
 * @returns {Array}
 */
function checkMissingAttributes() {
    var sfccToken   = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(sfccToken, SFCC_OBJECT_TYPE);

    try {
        sfccClient.ensureAttributeGroup(sfccToken, SFCC_OBJECT_TYPE, CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME);
    } catch (ge) {}

    var missing = [];
    var seen    = {};
    var ctpFields = getCtpTaxCategoryFields();
    var i;

    for (i = 0; i < ctpFields.length; i++) {
        var field = ctpFields[i];
        var id    = field.name;
        if (seen[id]) continue;
        seen[id] = true;
        if (!existingIds[id]) {
            missing.push(typeMap.enrichMissingAttribute({
                id:      field.name,
                label:   field.label,
                ctpType: field.ctpType
            }));
        } else {
            try { sfccClient.addAttributeToGroup(sfccToken, SFCC_OBJECT_TYPE, CTP_ATTR_GROUP_ID, id); } catch (age) {}
        }
    }

    return missing;
}

/**
 * Create attribute definitions on SFCC TaxClass system object.
 * @param {Array} attrs
 * @returns {{ created: number, failed: number, errors: Array }}
 */
function createAttributes(attrs) {
    var sfccToken = sfccClient.getSFCCToken();
    var created   = 0;
    var failed    = 0;
    var errors    = [];

    try {
        sfccClient.ensureAttributeGroup(sfccToken, SFCC_OBJECT_TYPE, CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME);
    } catch (ge) {}

    var i;
    for (i = 0; i < attrs.length; i++) {
        var attr = attrs[i];
        try {
            var def = attrBuilder.buildAttrDefinition(
                attr.id,
                attr.sfccType || 'string',
                attr.label    || attr.id
            );
            sfccClient.createAttributeDefinition(sfccToken, SFCC_OBJECT_TYPE, def);
            sfccClient.addAttributeToGroup(sfccToken, SFCC_OBJECT_TYPE, CTP_ATTR_GROUP_ID, attr.id);
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
