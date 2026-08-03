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
    if (platformId === 'shopify' || platformId === 'bigcommerce') {
        var typeMap = platformId === 'bigcommerce'
            ? require('*/cartridge/scripts/migration/connectors/bigcommerce/bigcommerceTypeMap')
            : shopifyTypeMap;
        return function (entry) {
            var sourceType = entry.sourceType || entry.ctpType || 'single_line_text_field';
            var sfccType   = entry.sfccType
                || (typeMap.resolveMetafieldType
                    ? typeMap.resolveMetafieldType(sourceType)
                    : typeMap.resolveFieldType(sourceType))
                || 'string';
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
    if (!field.sfccId && field.name && (platformId === 'shopify' || platformId === 'bigcommerce')) {
        sfccId = sourceAttrIds.toAttrId(field.name, platformId);
    } else if (!field.sfccId && field.name && platformId !== 'shopify' && platformId !== 'bigcommerce') {
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
 * @param {Object.<string, string>} [attrIdMap] - source attr id → SFCC attr id remaps
 * @returns {Array}
 */
function checkMissing(sfccObjectType, getCtpFieldsFn, getExtraFieldsFn, attrIdMap) {
    var platformId  = registry.getPlatformId();
    var group       = sourceAttrIds.getAttrGroup(platformId);
    var enrich      = getEnricher(platformId);
    var sfccToken   = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(sfccToken, sfccObjectType);
    var map         = attrIdMap && typeof attrIdMap === 'object' ? attrIdMap : {};
    var missing     = [];
    var seen        = {};
    var fields      = [];
    var i;
    var norm;
    var id;
    var resolvedId;

    try {
        sfccClient.ensureAttributeGroup(sfccToken, sfccObjectType, group.id, group.name);
    } catch (ge) {}

    if (platformId === 'shopify') {
        fields = shopifyMetafields.fieldsForSfccObject(sfccObjectType);
    } else if (platformId === 'bigcommerce' || platformId === 'sap') {
        // BigCommerce / SAP: use trace attrs from getExtraFieldsFn; no metafield catalog API.
        fields = [];
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

        resolvedId = map[id] && String(map[id]).trim() ? String(map[id]).trim() : id;

        if (!existingIds[resolvedId]) {
            missing.push(enrich({
                id:         id,
                label:      norm.label,
                sourceType: norm.sourceType,
                ctpType:    norm.sourceType
            }));
        } else {
            try {
                sfccClient.addAttributeToGroup(sfccToken, sfccObjectType, group.id, resolvedId);
            } catch (age) {}
        }
    }

    return missing;
}

/**
 * Create attribute definitions with exists/created/mapped result shape.
 * @param {string} sfccObjectType
 * @param {string} groupId
 * @param {string} groupName
 * @param {Array} attrs
 * @returns {{
 *   created: number,
 *   failed: number,
 *   alreadyExists: number,
 *   errors: Array,
 *   createdAttrs: Array,
 *   mappedAttrs: Array,
 *   results: Array
 * }}
 */
function createDefinitions(sfccObjectType, groupId, groupName, attrs) {
    var platformId  = registry.getPlatformId();
    var sfccToken   = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(sfccToken, sfccObjectType);
    var created     = 0;
    var failed      = 0;
    var alreadyExists = 0;
    var errors      = [];
    var createdAttrs = [];
    var mappedAttrs  = [];
    var results      = [];
    var i;
    var attr;
    var attrId;
    var canonicalId;

    try {
        sfccClient.ensureAttributeGroup(sfccToken, sfccObjectType, groupId, groupName);
    } catch (ge) {}

    for (i = 0; i < attrs.length; i++) {
        attr        = attrs[i];
        attrId      = sourceAttrIds.remapCamelAttrId(attr.id, platformId);
        canonicalId = attr.canonicalId || attr.sourceId || attr.id || attrId;

        if (!attrId) {
            failed++;
            if (errors.length < 5) errors.push('(empty): Attribute ID is required');
            results.push({
                id: '', canonicalId: canonicalId || '', status: 'error',
                message: 'Attribute ID is required'
            });
            continue;
        }

        if (existingIds[attrId]) {
            alreadyExists++;
            try {
                sfccClient.addAttributeToGroup(sfccToken, sfccObjectType, groupId, attrId);
            } catch (age) {}
            mappedAttrs.push({ id: attrId, canonicalId: canonicalId });
            results.push({
                id: attrId, canonicalId: canonicalId, status: 'exists',
                message: 'Already exists in SFCC'
            });
            continue;
        }

        try {
            var def = attrBuilder.buildAttrDefinition(
                attrId,
                attr.sfccType || 'string',
                attr.label    || attrId
            );
            sfccClient.createAttributeDefinition(sfccToken, sfccObjectType, def);
            sfccClient.addAttributeToGroup(sfccToken, sfccObjectType, groupId, attrId);
            existingIds[attrId] = true;
            created++;
            createdAttrs.push({ id: attrId, canonicalId: canonicalId });
            mappedAttrs.push({ id: attrId, canonicalId: canonicalId });
            results.push({
                id: attrId, canonicalId: canonicalId, status: 'created',
                message: 'Created'
            });
        } catch (e) {
            failed++;
            var errMsg = e.message || String(e);
            if (errors.length < 5) errors.push(attrId + ': ' + errMsg);
            results.push({
                id: attrId, canonicalId: canonicalId, status: 'error',
                message: errMsg
            });
        }
    }
    return {
        created:       created,
        failed:        failed,
        alreadyExists: alreadyExists,
        errors:        errors,
        createdAttrs:  createdAttrs,
        mappedAttrs:   mappedAttrs,
        results:       results
    };
}

/**
 * @param {string} sfccObjectType
 * @param {Array} attrs
 * @returns {{ created: number, failed: number, alreadyExists: number, errors: Array, createdAttrs: Array, mappedAttrs: Array, results: Array }}
 */
function createAttributes(sfccObjectType, attrs) {
    var platformId = registry.getPlatformId();
    var group      = sourceAttrIds.getAttrGroup(platformId);
    return createDefinitions(sfccObjectType, group.id, group.name, attrs);
}

module.exports = {
    checkMissing:       checkMissing,
    createAttributes:   createAttributes,
    createDefinitions:  createDefinitions,
    normalizeField:     normalizeField
};
