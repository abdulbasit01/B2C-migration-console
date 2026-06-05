'use strict';

var PRODUCT_TYPE_MAP = {
    text:            'string',
    ltext:           'string',
    enum:            'string',
    lenum:           'string',
    number:          'double',
    boolean:         'boolean',
    date:            'date',
    time:            'string',
    datetime:        'datetime',
    money:           'double',
    reference:       'string',
    nested:          'string',
    set:             'set_of_string',
    'set-of-string': 'set_of_string'
};

var CUSTOM_FIELD_TYPE_MAP = {
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
    Set:             'set_of_string'
};

// CTP resourceTypeId → SFCC system object type
var RESOURCE_TYPE_MAP = {
    'product':                       'Product',
    'product-variant':               'Product',
    'product-price':                 'Product',
    'category':                      'Category',
    'customer':                      'Customer',
    'customer-group':                'CustomerGroup',
    'order':                         'Order',
    'order-edit':                    'Order',
    'line-item':                     'Order',
    'custom-line-item':              'Order',
    'cart':                          'Order',
    'payment':                       'Order',
    'payment-interface-interaction': 'Order',
    'shopping-list':                 'ProductList',
    'shopping-list-text-line-item':  'ProductListItem',
    'inventory-entry':               'ProductInventoryRecord',
    'store':                         'SitePreferences',
    'discount-code':                 'Promotion',
    'cart-discount':                 'Promotion',
    'channel':                       'SitePreferences',
    'address':                       'Profile',
    'review':                        'Product'
};

// CTP types that map to product-related resource IDs
var PRODUCT_RESOURCE_IDS = ['product', 'product-variant', 'product-price'];

var _PERFECT = ['text', 'ltext', 'boolean', 'date', 'datetime', 'number', 'String', 'LocalizedString', 'Boolean', 'Date', 'DateTime', 'Number', 'Integer'];
var _HIGH    = ['enum', 'lenum', 'time', 'Enum', 'LocalizedEnum', 'Time'];
var _MEDIUM  = ['money', 'reference', 'Money', 'Reference'];

function resolveProductType(ctpType) {
    return PRODUCT_TYPE_MAP[ctpType] || 'string';
}

function resolveCustomFieldType(typeName) {
    return CUSTOM_FIELD_TYPE_MAP[typeName] || 'string';
}

function resolveResourceType(resourceTypeId) {
    return RESOURCE_TYPE_MAP[resourceTypeId] || null;
}

function confidence(ctpType) {
    if (_PERFECT.indexOf(ctpType) >= 0) return 100;
    if (_HIGH.indexOf(ctpType) >= 0) return 98;
    if (_MEDIUM.indexOf(ctpType) >= 0) return 95;
    return 90;
}

module.exports = {
    resolveProductType:     resolveProductType,
    resolveCustomFieldType: resolveCustomFieldType,
    resolveResourceType:    resolveResourceType,
    confidence:             confidence,
    RESOURCE_TYPE_MAP:      RESOURCE_TYPE_MAP,
    PRODUCT_RESOURCE_IDS:   PRODUCT_RESOURCE_IDS
};
