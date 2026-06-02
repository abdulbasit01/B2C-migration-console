'use strict';

var typeMap = require('*/cartridge/scripts/migration/typeMap');

/**
 * Get English label from CTP localized string or plain string.
 * @param {Object|string} obj - localized object or string
 * @returns {string} English label
 */
function toLabel(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    return obj.en || obj['en-US'] || Object.keys(obj).map(function (k) { return obj[k]; })[0] || '';
}

/**
 * Build a standard SFCC attribute definition payload.
 * @param {string} id - attribute ID
 * @param {string} valueType - SFCC value_type (string, int, boolean, etc.)
 * @param {string} label - display label
 * @returns {Object} SFCC attribute definition
 */
function buildAttrDefinition(id, valueType, label) {
    return {
        id:                  id,
        value_type:          valueType,
        mandatory:           false,
        searchable:          false,
        externally_defined:  false,
        externally_managed:  false,
        order_required:      false,
        display_name:        { default: label || id }
    };
}

// ─── From CTP ProductType ─────────────────────────────────────────────────────

/**
 * Transform a CTP ProductType attribute definition → SFCC Product attribute definition.
 * Source: GET /{projectKey}/product-types
 * @param {Object} ctpAttr - CTP AttributeDefinition
 * @returns {Object} SFCC attribute definition payload
 */
function transformProductTypeAttr(ctpAttr) {
    var attrType  = ctpAttr.type && ctpAttr.type.name ? ctpAttr.type.name : 'text';
    var valueType = typeMap.resolveProductAttrType(attrType);
    var label     = toLabel(ctpAttr.label) || ctpAttr.name;
    return buildAttrDefinition(ctpAttr.name, valueType, label);
}

// ─── From CTP Custom Types ────────────────────────────────────────────────────

/**
 * Transform a CTP FieldDefinition → SFCC attribute definition for a given object type.
 * Source: GET /{projectKey}/types
 * @param {Object} field - CTP FieldDefinition
 * @returns {Object} SFCC attribute definition payload
 */
function transformCustomTypeField(field) {
    var typeName  = field.type && field.type.name ? field.type.name : 'String';
    var valueType = typeMap.resolveCustomFieldType(typeName);
    var label     = toLabel(field.label) || field.name;
    return buildAttrDefinition(field.name, valueType, label);
}

// ─── Schema summary for Fetch step ───────────────────────────────────────────

/**
 * Summarise CTP schema sources into a flat count object.
 * @param {Array} productTypes - CTP ProductType array
 * @param {Array} customTypes - CTP Custom Type array
 * @returns {Object} counts per SFCC object type
 */
function summariseSchema(productTypes, customTypes) {
    var counts = {};
    var i;
    var j;

    // Product attributes from ProductTypes
    for (i = 0; i < productTypes.length; i++) {
        var attrs = productTypes[i].attributes || [];
        counts.Product = (counts.Product || 0) + attrs.length;
    }

    // Custom type fields grouped by SFCC object type
    for (i = 0; i < customTypes.length; i++) {
        var resourceTypeIds = customTypes[i].resourceTypeIds || [];
        var fields          = customTypes[i].fieldDefinitions || [];
        for (j = 0; j < resourceTypeIds.length; j++) {
            var sfccType = typeMap.resolveSFCCObjectType(resourceTypeIds[j]);
            if (sfccType) {
                counts[sfccType] = (counts[sfccType] || 0) + fields.length;
            }
        }
    }

    return counts;
}

module.exports = {
    transformProductTypeAttr:  transformProductTypeAttr,
    transformCustomTypeField:  transformCustomTypeField,
    summariseSchema:           summariseSchema,
    buildAttrDefinition:       buildAttrDefinition,
    toLabel:                   toLabel
};
