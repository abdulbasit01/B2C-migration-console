'use strict';

// SAP Commerce (Hybris) attribute Java type → SFCC attribute value_type.
// Source: standard hybris type system atomic types (see Type/AtomicType in Backoffice).
var ATTRIBUTE_TYPE_MAP = {
    'java.lang.String':     'string',
    localized:              'string',
    'java.lang.Boolean':    'boolean',
    'java.lang.Integer':    'int',
    'java.lang.Long':       'int',
    'java.lang.Short':      'int',
    'java.math.BigDecimal': 'double',
    'java.lang.Double':     'double',
    'java.lang.Float':      'double',
    'java.util.Date':       'datetime',
    date:                   'date',
    datetime:               'datetime',
    collection:              'set_of_string',
    'java.util.Collection':  'set_of_string'
};

// OCC ComposedType uid → SFCC system object type (Phase 1: Product only)
var TYPE_CODE_MAP = {
    Product:  'Product',
    Category: 'Category'
};

var _PERFECT = ['java.lang.String', 'localized', 'java.lang.Boolean', 'java.lang.Integer', 'date', 'datetime'];
var _HIGH    = ['java.lang.Long', 'java.lang.Short', 'java.math.BigDecimal', 'java.lang.Double', 'java.lang.Float', 'java.util.Date'];

/**
 * @param {string} sapType
 * @returns {string} SFCC value_type
 */
function resolveAttributeType(sapType) {
    return ATTRIBUTE_TYPE_MAP[sapType] || 'string';
}

/**
 * @param {string} typeCode
 * @returns {string|null}
 */
function resolveTypeCode(typeCode) {
    return TYPE_CODE_MAP[typeCode] || null;
}

/**
 * @param {string} sapType
 * @returns {number}
 */
function confidence(sapType) {
    if (_PERFECT.indexOf(sapType) >= 0) return 100;
    if (_HIGH.indexOf(sapType) >= 0) return 95;
    if (sapType === 'collection' || sapType === 'java.util.Collection') return 92;
    return 90;
}

module.exports = {
    resolveAttributeType: resolveAttributeType,
    resolveTypeCode:      resolveTypeCode,
    confidence:           confidence,
    ATTRIBUTE_TYPE_MAP:   ATTRIBUTE_TYPE_MAP,
    TYPE_CODE_MAP:        TYPE_CODE_MAP
};
