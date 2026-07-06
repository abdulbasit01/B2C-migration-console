'use strict';

var typeMap     = require('*/cartridge/scripts/migration/connectors/shopify/shopifyTypeMap');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');

/**
 * Transform a Shopify metafield definition → SFCC attribute definition.
 * ID is built as namespace__key to prevent collisions across namespaces.
 * @param {Object} def - { name, key, namespace, type: { name } }
 * @returns {Object} SFCC attribute definition
 */
function transformMetafieldDef(def) {
    var shopifyType = def.type && typeof def.type === 'object' ? def.type.name : (String(def.type || 'single_line_text_field'));
    var valueType   = typeMap.resolveMetafieldType(shopifyType);
    var rawId       = def.namespace ? def.namespace + '__' + def.key : def.key;
    var id          = rawId.replace(/[^a-zA-Z0-9_]/g, '_');
    var label       = def.name || def.key;
    return attrBuilder.buildAttrDefinition(id, valueType, label);
}

/**
 * Transform a standard Shopify product or variant field → SFCC attribute definition.
 * @param {Object} field - { key, type, label }
 * @returns {Object} SFCC attribute definition
 */
function transformStandardField(field) {
    var valueType = typeMap.resolveMetafieldType(field.type || 'single_line_text_field');
    return attrBuilder.buildAttrDefinition(field.key, valueType, field.label || field.key);
}

module.exports = { transformMetafieldDef: transformMetafieldDef, transformStandardField: transformStandardField };
