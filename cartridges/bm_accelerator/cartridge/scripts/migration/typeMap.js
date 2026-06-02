'use strict';

/**
 * CTP ProductType attribute type → SFCC attribute value_type
 * Source: https://docs.commercetools.com/api/projects/productTypes
 */
var PRODUCT_TYPE_MAP = {
    text:      'string',
    ltext:     'string',
    enum:      'string',
    lenum:     'string',
    number:    'double',
    boolean:   'boolean',
    date:      'date',
    time:      'string',
    datetime:  'datetime',
    money:     'double',
    reference: 'string',
    nested:    'string',
    set:       'set-of-string'
};

/**
 * CTP Custom Type field name → SFCC attribute value_type
 * Source: https://docs.commercetools.com/api/projects/types
 */
var CUSTOM_TYPE_MAP = {
    String:          'string',
    LocalizedString: 'string',
    Number:          'double',
    Integer:         'int',
    Boolean:         'boolean',
    Date:            'date',
    Time:            'string',
    DateTime:        'datetime',
    Money:           'double',
    Enum:            'string',
    LocalizedEnum:   'string',
    Reference:       'string',
    Set:             'set-of-string'
};

/**
 * CTP resourceTypeId → SFCC system object type
 * Controls which SFCC object gets the custom attribute definition.
 */
var RESOURCE_TYPE_MAP = {
    'product':               'Product',
    'product-variant':       'Product',
    'product-price':         'Product',
    'category':              'Category',
    'customer':              'Customer',
    'customer-group':        'CustomerGroup',
    'order':                 'Order',
    'order-edit':            'Order',
    'line-item':             'Order',
    'custom-line-item':      'Order',
    'cart':                  'Order',
    'payment':               'Order',
    'payment-interface-interaction': 'Order',
    'shopping-list':         'ProductList',
    'shopping-list-text-line-item': 'ProductListItem',
    'inventory-entry':       'ProductInventoryRecord',
    'store':                 'SitePreferences',
    'discount-code':         'Promotion',
    'cart-discount':         'Promotion',
    'channel':               'SitePreferences',
    'address':               'Profile',
    'review':                'Product'
};

/**
 * Resolve CTP ProductType attribute type string → SFCC value_type.
 * @param {string} ctpType - CTP attribute type (e.g. 'text', 'number')
 * @returns {string} SFCC value_type
 */
function resolveProductAttrType(ctpType) {
    return PRODUCT_TYPE_MAP[ctpType] || 'string';
}

/**
 * Resolve CTP Custom Type field type name → SFCC value_type.
 * @param {string} ctpFieldTypeName - CTP FieldType name (e.g. 'String', 'Boolean')
 * @returns {string} SFCC value_type
 */
function resolveCustomFieldType(ctpFieldTypeName) {
    return CUSTOM_TYPE_MAP[ctpFieldTypeName] || 'string';
}

/**
 * Resolve CTP resourceTypeId → SFCC system object type.
 * @param {string} resourceTypeId - CTP resource type (e.g. 'product', 'order')
 * @returns {string|null} SFCC object type or null if not supported
 */
function resolveSFCCObjectType(resourceTypeId) {
    return RESOURCE_TYPE_MAP[resourceTypeId] || null;
}

module.exports = {
    resolveProductAttrType: resolveProductAttrType,
    resolveCustomFieldType: resolveCustomFieldType,
    resolveSFCCObjectType: resolveSFCCObjectType,
    PRODUCT_TYPE_MAP: PRODUCT_TYPE_MAP,
    CUSTOM_TYPE_MAP: CUSTOM_TYPE_MAP,
    RESOURCE_TYPE_MAP: RESOURCE_TYPE_MAP
};
