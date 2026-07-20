'use strict';

// Shopify metafield type → SFCC attribute value_type
// Source: https://shopify.dev/docs/apps/build/custom-data/metafields/list-of-data-types
var METAFIELD_TYPE_MAP = {
    single_line_text_field:      'string',
    multi_line_text_field:       'string',
    rich_text_field:             'string',
    url:                         'string',
    color:                       'string',
    json:                        'string',
    number_integer:              'int',
    number_decimal:              'double',
    boolean:                     'boolean',
    date:                        'date',
    date_time:                   'datetime',
    money:                       'double',
    rating:                      'double',
    dimension:                   'double',
    volume:                      'double',
    weight:                      'double',
    file_reference:              'string',
    page_reference:              'string',
    product_reference:           'string',
    variant_reference:           'string',
    collection_reference:        'string',
    customer_reference:          'string',
    metaobject_reference:        'string',
    mixed_reference:             'string',
    'list.single_line_text_field': 'set_of_string',
    'list.color':                'set_of_string',
    'list.date':                 'set_of_string',
    'list.date_time':            'set_of_string',
    'list.number_integer':       'set_of_string',
    'list.number_decimal':       'set_of_string',
    'list.file_reference':       'set_of_string',
    'list.product_reference':    'set_of_string',
    'list.variant_reference':    'set_of_string',
    'list.collection_reference': 'set_of_string',
    'list.page_reference':       'set_of_string',
    'list.metaobject_reference': 'set_of_string',
    'list.mixed_reference':      'set_of_string'
};

// GraphQL owner type → SFCC system object type
var OWNER_TYPE_MAP = {
    PRODUCT:         'Product',
    PRODUCTVARIANT:  'Product',
    COLLECTION:      'Category',
    CUSTOMER:        'Customer',
    ORDER:           'Order'
};

var _PERFECT = ['single_line_text_field', 'multi_line_text_field', 'number_integer', 'number_decimal', 'boolean', 'date', 'date_time'];
var _HIGH    = ['url', 'color', 'rating', 'dimension', 'volume', 'weight', 'rich_text_field'];
var _MEDIUM  = ['money', 'json', 'file_reference', 'page_reference'];

function resolveMetafieldType(shopifyType) {
    return METAFIELD_TYPE_MAP[shopifyType] || 'string';
}

function resolveOwnerType(ownerType) {
    return OWNER_TYPE_MAP[ownerType] || null;
}

function confidence(shopifyType) {
    if (_PERFECT.indexOf(shopifyType) >= 0) return 100;
    if (_HIGH.indexOf(shopifyType) >= 0) return 98;
    if (_MEDIUM.indexOf(shopifyType) >= 0) return 95;
    if (shopifyType && shopifyType.indexOf('list.') === 0) return 92;
    return 90;
}

module.exports = {
    resolveMetafieldType: resolveMetafieldType,
    resolveOwnerType:     resolveOwnerType,
    confidence:           confidence,
    METAFIELD_TYPE_MAP:   METAFIELD_TYPE_MAP,
    OWNER_TYPE_MAP:       OWNER_TYPE_MAP
};
