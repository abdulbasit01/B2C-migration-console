'use strict';

// BigCommerce field type → SFCC attribute value_type
var FIELD_TYPE_MAP = {
    string:             'string',
    text:               'string',
    multiline:          'string',
    html:               'string',
    url:                'string',
    email:              'string',
    phone:              'string',
    number:             'double',
    integer:            'int',
    decimal:            'double',
    float:              'double',
    boolean:            'boolean',
    date:               'date',
    datetime:           'datetime',
    money:              'double',
    enum:               'string',
    set_of_string:      'set_of_string',
    single_line_text_field: 'string',
    multi_line_text_field:  'string',
    number_integer:         'int',
    number_decimal:         'double',
    'list.single_line_text_field': 'set_of_string'
};

var _PERFECT = ['string', 'text', 'integer', 'number_integer', 'boolean', 'date', 'datetime', 'single_line_text_field'];
var _HIGH    = ['url', 'email', 'phone', 'html', 'multiline', 'multi_line_text_field', 'decimal', 'number_decimal', 'float', 'number'];
var _MEDIUM  = ['money', 'enum'];

function resolveFieldType(bcType) {
    return FIELD_TYPE_MAP[bcType] || 'string';
}

function confidence(bcType) {
    if (_PERFECT.indexOf(bcType) >= 0) return 100;
    if (_HIGH.indexOf(bcType) >= 0) return 98;
    if (_MEDIUM.indexOf(bcType) >= 0) return 95;
    if (bcType && String(bcType).indexOf('list.') === 0) return 92;
    return 90;
}

module.exports = {
    resolveFieldType: resolveFieldType,
    confidence:       confidence,
    FIELD_TYPE_MAP:   FIELD_TYPE_MAP
};
