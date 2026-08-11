'use strict';

var typeMap     = require('*/cartridge/scripts/migration/connectors/ctp/ctpTypeMap');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');

function transformProductAttr(ctpAttr) {
    var ctpType   = ctpAttr.type && ctpAttr.type.name ? ctpAttr.type.name : 'text';
    var valueType = typeMap.resolveProductType(ctpType);
    var label     = attrBuilder.toLabel(ctpAttr.label) || ctpAttr.name;
    return attrBuilder.buildAttrDefinition(ctpAttr.name, valueType, label);
}

function transformCustomField(field) {
    var typeName  = field.type && field.type.name ? field.type.name : 'String';
    var valueType = typeMap.resolveCustomFieldType(typeName);
    var label     = attrBuilder.toLabel(field.label) || field.name;
    return attrBuilder.buildAttrDefinition(field.name, valueType, label);
}

module.exports = { transformProductAttr: transformProductAttr, transformCustomField: transformCustomField };
