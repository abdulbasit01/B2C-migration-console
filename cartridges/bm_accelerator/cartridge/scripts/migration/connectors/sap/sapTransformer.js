'use strict';

var typeMap     = require('*/cartridge/scripts/migration/connectors/sap/sapTypeMap');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');

/**
 * Transform an SAP Commerce type-system attribute descriptor → SFCC attribute definition.
 * @param {Object} attr - { qualifier, type, name }
 * @returns {Object} SFCC attribute definition
 */
function transformAttributeDef(attr) {
    var sapType = attr.type || 'java.lang.String';
    var valueType = typeMap.resolveAttributeType(sapType);
    var id        = String(attr.qualifier || '').replace(/[^a-zA-Z0-9_]/g, '_');
    var label     = attr.name || attr.qualifier;
    return attrBuilder.buildAttrDefinition(id, valueType, label);
}

/**
 * Transform a standard OCC Product field → SFCC attribute definition.
 * @param {Object} field - { key, type, label }
 * @returns {Object} SFCC attribute definition
 */
function transformStandardField(field) {
    var valueType = typeMap.resolveAttributeType(field.type || 'java.lang.String');
    return attrBuilder.buildAttrDefinition(field.key, valueType, field.label || field.key);
}

module.exports = { transformAttributeDef: transformAttributeDef, transformStandardField: transformStandardField };
