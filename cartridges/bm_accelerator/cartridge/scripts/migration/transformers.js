'use strict';

function localizedString(obj) {
    if (!obj || typeof obj === 'string') return obj || '';
    return obj['en-US'] || obj.en || Object.keys(obj).map(function (k) { return obj[k]; })[0] || '';
}

function flattenAttrValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object' && 'key' in value && 'label' in value) return value.key;
    if (typeof value === 'object' && 'typeId' in value && 'id' in value) return value.id;
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === 'object') return localizedString(value);
    return value;
}

function buildCustomAttributes(attributes) {
    if (!attributes || !attributes.length) return undefined;
    var attrs = [];
    for (var i = 0; i < attributes.length; i++) {
        var val = flattenAttrValue(attributes[i].value);
        if (val !== null && val !== undefined) {
            attrs.push({ attribute_id: attributes[i].name, value: val });
        }
    }
    return attrs.length ? attrs : undefined;
}

function transformProduct(src) {
    var current = (src.masterData && (src.masterData.current || src.masterData.staged)) || {};
    var masterVariant = current.masterVariant || {};
    var productId = src.key || src.id;
    var name = localizedString(current.name);
    var descText = current.description ? localizedString(current.description) : null;

    return {
        id: productId,
        name: { default: name },
        short_description: descText ? { default: { markup: descText, source: descText } } : undefined,
        online: true,
        searchable: true,
        primary_category_id: (current.categories && current.categories[0]) ? current.categories[0].id : undefined,
        custom_attributes: buildCustomAttributes(masterVariant.attributes)
    };
}

function transformCategory(src) {
    return {
        id: src.key || src.id,
        name: { default: localizedString(src.name) },
        description: src.description ? { default: localizedString(src.description) } : undefined,
        parent_category_id: (src.parent && src.parent.id) ? src.parent.id : undefined,
        online: true
    };
}

function transformCustomer(src) {
    var addresses = [];
    if (src.addresses) {
        for (var i = 0; i < src.addresses.length; i++) {
            var addr = src.addresses[i];
            var street = [addr.streetName, addr.streetNumber].filter(Boolean).join(' ');
            addresses.push({
                address_id: addr.key || addr.id,
                address1: street || addr.streetName || '',
                city: addr.city || '',
                state_code: addr.state || '',
                postal_code: addr.postalCode || '',
                country_code: addr.country || 'US',
                first_name: addr.firstName || '',
                last_name: addr.lastName || ''
            });
        }
    }
    return {
        customer_no: src.customerNumber || undefined,
        first_name: src.firstName || '',
        last_name: src.lastName || '',
        email: src.email || '',
        enabled: src.isEmailVerified !== false,
        addresses: addresses
    };
}

function transformInventory(src) {
    return {
        product_id: src.sku,
        allocation: src.quantityOnStock || 0,
        perpetual: false,
        preorderable: false,
        backorderable: (src.restockableInDays || 0) > 0
    };
}

module.exports = {
    transformProduct: transformProduct,
    transformCategory: transformCategory,
    transformCustomer: transformCustomer,
    transformInventory: transformInventory
};
