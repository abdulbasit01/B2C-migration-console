'use strict';

var shopifyApi = require('*/cartridge/scripts/migration/core/shopifyApi');

var _catalogByInventoryItemId = null;

/**
 * Load all Shopify products and index variants by inventory_item_id.
 * Every sellable product has at least one variant (including "simple" products).
 * @returns {Object<string, { sku: string, variantId: string, productId: string, handle: string, title: string }>}
 */
function getByInventoryItemId() {
    if (_catalogByInventoryItemId) {
        return _catalogByInventoryItemId;
    }

    _catalogByInventoryItemId = {};
    var products = shopifyApi.fetchAll('/products.json', 'products', null, { limit: 250 });
    var pi;

    for (pi = 0; pi < products.length; pi++) {
        var product  = products[pi];
        var variants = product.variants || [];
        var vi;

        for (vi = 0; vi < variants.length; vi++) {
            var variant = variants[vi];
            if (!variant.inventory_item_id) {
                continue;
            }
            _catalogByInventoryItemId[String(variant.inventory_item_id)] = {
                sku:       variant.sku ? String(variant.sku).trim() : '',
                variantId: variant.id ? String(variant.id) : '',
                productId: product.id ? String(product.id) : '',
                handle:    product.handle ? String(product.handle) : '',
                title:     product.title || ''
            };
        }
    }

    return _catalogByInventoryItemId;
}

function clearCatalogCache() {
    _catalogByInventoryItemId = null;
}

/**
 * @param {string|number} inventoryItemId
 * @returns {Object|null}
 */
function lookupByInventoryItemId(inventoryItemId) {
    if (!inventoryItemId) return null;
    return getByInventoryItemId()[String(inventoryItemId)] || null;
}

module.exports = {
    getByInventoryItemId:    getByInventoryItemId,
    lookupByInventoryItemId: lookupByInventoryItemId,
    clearCatalogCache:       clearCatalogCache
};
