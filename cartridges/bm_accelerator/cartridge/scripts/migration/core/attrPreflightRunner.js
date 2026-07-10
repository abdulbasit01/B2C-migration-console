'use strict';

var registry           = require('*/cartridge/scripts/migration/core/dataSourceRegistry');
var sourceAttrIds      = require('*/cartridge/scripts/migration/core/sourceAttrIds');
var shopifyMetafields  = require('*/cartridge/scripts/migration/core/shopifyMetafieldFields');
var ctpTypeMap         = require('*/cartridge/scripts/migration/connectors/ctp/ctpTypeMap');
var shopifyTypeMap     = require('*/cartridge/scripts/migration/connectors/shopify/shopifyTypeMap');
var sfccClient         = require('*/cartridge/scripts/migration/sfccClient');
var attrBuilder        = require('*/cartridge/scripts/migration/core/attrBuilder');

/**
 * @param {string} platformId
 * @returns {Function}
 */
function getEnricher(platformId) {
    if (platformId === 'shopify') {
        return function (entry) {
            var sourceType = entry.sourceType || entry.ctpType || 'single_line_text_field';
            var sfccType   = entry.sfccType || shopifyTypeMap.resolveMetafieldType(sourceType) || 'string';
            return {
                id:              entry.id,
                label:           entry.label,
                ctpType:         sourceType,
                sfccType:        sfccType,
                sfccTypeOptions: [{ value: sfccType, label: sfccType }]
            };
        };
    }
    return ctpTypeMap.enrichMissingAttribute;
}

/**
 * Normalize a field descriptor to { sfccId, label, sourceType }.
 * @param {Object} field
 * @param {string} platformId
 * @returns {{ sfccId: string, label: string, sourceType: string }}
 */
function normalizeField(field, platformId) {
    var sourceType = field.sourceType || field.ctpType || 'String';
    var sfccId     = field.sfccId || field.id || field.name;
    if (!field.sfccId && field.name && platformId === 'shopify') {
        sfccId = sourceAttrIds.toAttrId(field.name, platformId);
    } else if (!field.sfccId && field.name && platformId !== 'shopify') {
        sfccId = field.name;
    }
    sfccId = sourceAttrIds.remapCamelAttrId(sfccId, platformId);
    return {
        sfccId:     sfccId,
        label:      field.label || sfccId,
        sourceType: sourceType
    };
}

/**
 * @param {string} sfccObjectType
 * @param {Function} getCtpFieldsFn - () => Array of { name, label, ctpType } or trace attrs
 * @param {Function} [getExtraFieldsFn] - (platformId) => Array of extra trace attrs
 * @returns {Array}
 */
function checkMissing(sfccObjectType, getCtpFieldsFn, getExtraFieldsFn) {
    var platformId  = registry.getPlatformId();
    var group       = sourceAttrIds.getAttrGroup(platformId);
    var enrich      = getEnricher(platformId);
    var sfccToken   = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(sfccToken, sfccObjectType);
    var missing     = [];
    var seen        = {};
    var fields      = [];
    var i;
    var norm;
    var id;

    try {
        sfccClient.ensureAttributeGroup(sfccToken, sfccObjectType, group.id, group.name);
    } catch (ge) {}

    if (platformId === 'shopify') {
        fields = shopifyMetafields.fieldsForSfccObject(sfccObjectType);
    } else if (getCtpFieldsFn) {
        fields = getCtpFieldsFn();
    }

    if (getExtraFieldsFn) {
        var extra = getExtraFieldsFn(platformId) || [];
        for (i = 0; i < extra.length; i++) {
            fields.push(extra[i]);
        }
    }

    for (i = 0; i < fields.length; i++) {
        norm = normalizeField(fields[i], platformId);
        id   = norm.sfccId;
        if (!id || seen[id]) continue;
        seen[id] = true;
        if (!existingIds[id]) {
            missing.push(enrich({
                id:         id,
                label:      norm.label,
                sourceType: norm.sourceType,
                ctpType:    norm.sourceType
            }));
        } else {
            try {
                sfccClient.addAttributeToGroup(sfccToken, sfccObjectType, group.id, id);
            } catch (age) {}
        }
    }

    return missing;
}

/**
 * @param {string} sfccObjectType
 * @param {Array} attrs
 * @returns {{ created: number, failed: number, errors: Array }}
 */
function createAttributes(sfccObjectType, attrs) {
    var platformId = registry.getPlatformId();
    var group      = sourceAttrIds.getAttrGroup(platformId);
    var sfccToken  = sfccClient.getSFCCToken();
    var created    = 0;
    var failed     = 0;
    var errors     = [];
    var i;
    var attr;
    var attrId;

    try {
        sfccClient.ensureAttributeGroup(sfccToken, sfccObjectType, group.id, group.name);
    } catch (ge) {}

    for (i = 0; i < attrs.length; i++) {
        attr   = attrs[i];
        attrId = sourceAttrIds.remapCamelAttrId(attr.id, platformId);
        try {
            var def = attrBuilder.buildAttrDefinition(
                attrId,
                attr.sfccType || 'string',
                attr.label    || attrId
            );
            sfccClient.createAttributeDefinition(sfccToken, sfccObjectType, def);
            sfccClient.addAttributeToGroup(sfccToken, sfccObjectType, group.id, attrId);
            created++;
        } catch (e) {
            failed++;
            if (errors.length < 5) errors.push(attrId + ': ' + (e.message || String(e)));
        }
    }
    return { created: created, failed: failed, errors: errors };
}

module.exports = {
    checkMissing:       checkMissing,
    createAttributes:   createAttributes,
    normalizeField:     normalizeField
};
