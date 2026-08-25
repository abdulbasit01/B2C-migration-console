'use strict';

var typeMap     = require('*/cartridge/scripts/migration/connectors/bigcommerce/bigcommerceTypeMap');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');

/**
 * Transform a standard BigCommerce field → SFCC attribute definition.
 * @param {Object} field - { key, type, label }
 * @returns {Object}
 */
function transformStandardField(field) {
    var valueType = typeMap.resolveFieldType(field.type || 'string');
    return attrBuilder.buildAttrDefinition(field.key, valueType, field.label || field.key, {
        sourceType:     field.type || 'string',
        sfccObjectType: field.sfccObjectType || null
    });
}

/**
 * Transform a BigCommerce product custom_field → SFCC attribute definition.
 * @param {Object} cf - { name, id } or { key, type, label }
 * @returns {Object}
 */
function transformCustomField(cf) {
    var rawId = cf.key || cf.name || ('cf_' + (cf.id || 'field'));
    var id    = String(rawId).replace(/[^a-zA-Z0-9_]/g, '_');
    var label = cf.label || cf.name || id;
    var valueType = typeMap.resolveFieldType(cf.type || 'string');
    return attrBuilder.buildAttrDefinition(id, valueType, label, {
        sourceType:     cf.type || 'string',
        sfccObjectType: cf.sfccObjectType || null
    });
}

module.exports = {
    transformStandardField: transformStandardField,
    transformCustomField:   transformCustomField
};
