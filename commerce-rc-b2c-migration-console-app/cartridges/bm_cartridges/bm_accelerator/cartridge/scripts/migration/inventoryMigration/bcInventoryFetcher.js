'use strict';

var bigcommerceApi = require('*/cartridge/scripts/migration/core/bigcommerceApi');

var _countCache = {};
var _locationIdsCache = null;
var _skuCatalogCache = null;

function normalizeLocationId(locationId) {
    if (!locationId || locationId === 'all') return '';
    return String(locationId);
}

function locationToChannel(loc) {
    return {
        id:   String(loc.id),
        key:  'bc-loc-' + loc.id,
        name: loc.label || loc.code || ('Location ' + loc.id)
    };
}

/**
 * @returns {Array}
 */
function fetchInventoryLocations() {
    return bigcommerceApi.fetchAll('/inventory/locations', null, {
        version: 'v3',
        limit:   250
    });
}

/**
 * Catalog SKU lookup keyed by variant_id and product_id.
 * Used when inventory identity.sku is empty.
 * @returns {{ byVariantId: Object, byProductId: Object }}
 */
function getSkuCatalog() {
    if (_skuCatalogCache) return _skuCatalogCache;

    var byVariantId = {};
    var byProductId = {};
    var products = bigcommerceApi.fetchAll('/catalog/products', null, {
        version:     'v3',
        limit:       250,
        queryParams: 'include=variants'
    });
    var pi;
    for (pi = 0; pi < products.length; pi++) {
        var p = products[pi];
        if (!p) continue;
        var productId = p.id != null ? String(p.id) : '';
        if (productId && p.sku) {
            byProductId[productId] = String(p.sku);
        }
        var variants = p.variants || [];
        var vi;
        for (vi = 0; vi < variants.length; vi++) {
            var v = variants[vi];
            if (!v || v.id == null) continue;
            var vid = String(v.id);
            if (v.sku) {
                byVariantId[vid] = String(v.sku);
            } else if (p.sku) {
                byVariantId[vid] = String(p.sku);
            }
        }
    }

    _skuCatalogCache = { byVariantId: byVariantId, byProductId: byProductId };
    return _skuCatalogCache;
}

function clearCaches() {
    _countCache       = {};
    _locationIdsCache = null;
    _skuCatalogCache  = null;
}

/**
 * @returns {Array<{id: string, key: string, name: string}>}
 */
function fetchSupplyChannels() {
    var locations = fetchInventoryLocations();
    var out       = [];
    var ids       = [];
    var i;
    for (i = 0; i < locations.length; i++) {
        var ch = locationToChannel(locations[i]);
        out.push(ch);
        ids.push(ch.id);
    }
    clearCaches();
    _locationIdsCache = ids;
    return out;
}

/**
 * @returns {string[]}
 */
function getActiveLocationIds() {
    if (_locationIdsCache) {
        return _locationIdsCache;
    }
    fetchSupplyChannels();
    return _locationIdsCache || [];
}

/**
 * Resolve sku / productId for an inventory identity row.
 * @param {Object} identity
 * @returns {{ sku: string, productId: string }|null}
 */
function resolveIds(identity) {
    if (!identity) return null;
    var variantId = identity.variant_id != null ? String(identity.variant_id) : '';
    var productId = identity.product_id != null ? String(identity.product_id) : '';
    var sku       = identity.sku ? String(identity.sku) : '';

    if (!sku) {
        var catalog = getSkuCatalog();
        if (variantId && catalog.byVariantId[variantId]) {
            sku = catalog.byVariantId[variantId];
        } else if (productId && catalog.byProductId[productId]) {
            sku = catalog.byProductId[productId];
        }
    }

    // Prefer variant id as SFCC product key when present (matches bcProductTransformer).
    var sfccProductId = variantId || productId || sku;
    if (!sfccProductId) return null;
    if (!sku) sku = sfccProductId;

    return { sku: sku, productId: sfccProductId };
}

/**
 * Flatten one inventory item (with nested locations) into export rows.
 * @param {Object} item
 * @param {string} [filterLocationId]
 * @returns {Array}
 */
function flattenItem(item, filterLocationId) {
    var ids = resolveIds(item && item.identity);
    if (!ids) return [];

    var locations = item.locations || [];
    // Single-location endpoint shape: available_to_sell at top level
    if ((!locations || !locations.length) && item.available_to_sell != null) {
        locations = [{
            location_id:            filterLocationId || null,
            available_to_sell:      item.available_to_sell,
            total_inventory_onhand: item.total_inventory_onhand
        }];
    }

    var out = [];
    var i;
    for (i = 0; i < locations.length; i++) {
        var loc = locations[i];
        if (!loc) continue;
        var locId = loc.location_id != null ? String(loc.location_id) : '';
        if (filterLocationId && locId && locId !== filterLocationId) continue;

        var available = typeof loc.available_to_sell === 'number'
            ? loc.available_to_sell
            : (typeof item.available_to_sell === 'number' ? item.available_to_sell : 0);
        var onHand = typeof loc.total_inventory_onhand === 'number'
            ? loc.total_inventory_onhand
            : (typeof item.total_inventory_onhand === 'number' ? item.total_inventory_onhand : available);

        out.push({
            sku:               ids.sku,
            productId:         ids.productId,
            availableQuantity: available,
            quantityOnStock:   onHand,
            lastModifiedAt:    new Date().toISOString(),
            supplyChannel:     locId ? { id: locId } : null
        });
    }
    return out;
}

/**
 * Fetch inventory rows for one location or all locations.
 * @param {string} [locationId]
 * @returns {Array}
 */
function fetchAllInventoryRows(locationId) {
    var locId = normalizeLocationId(locationId);
    var items;

    if (locId) {
        items = bigcommerceApi.fetchAll('/inventory/locations/' + encodeURIComponent(locId) + '/items', null, {
            version: 'v3',
            limit:   250
        });
    } else {
        var ids = getActiveLocationIds();
        var qs  = ids.length ? ('location_id:in=' + ids.map(encodeURIComponent).join(',')) : '';
        items = bigcommerceApi.fetchAll('/inventory/items', null, {
            version:     'v3',
            limit:       250,
            queryParams: qs
        });
    }

    var rows = [];
    var i;
    for (i = 0; i < items.length; i++) {
        rows = rows.concat(flattenItem(items[i], locId));
    }
    return rows;
}

/**
 * @param {string} [supplyChannelId]
 * @returns {number}
 */
function getCount(supplyChannelId) {
    var cacheKey = normalizeLocationId(supplyChannelId) || 'all';
    if (_countCache[cacheKey] !== undefined) {
        return _countCache[cacheKey];
    }
    var total = fetchAllInventoryRows(supplyChannelId).length;
    _countCache[cacheKey] = total;
    return total;
}

/**
 * @param {number} offset
 * @param {number} limit
 * @param {string} [supplyChannelId]
 * @param {string} [sortField]
 * @returns {{ results: Array, total: number, streamOffset: number }}
 */
function fetchBatch(offset, limit, supplyChannelId, sortField) {
    var all   = fetchAllInventoryRows(supplyChannelId);
    var total = all.length;
    _countCache[normalizeLocationId(supplyChannelId) || 'all'] = total;

    if (sortField === 'sku') {
        all.sort(function (a, b) {
            return a.sku < b.sku ? -1 : (a.sku > b.sku ? 1 : 0);
        });
    }

    var start = offset || 0;
    var lim   = limit || 500;
    var slice = all.slice(start, start + lim);
    return {
        results:      slice,
        total:        total,
        streamOffset: start + slice.length
    };
}

module.exports = {
    getCount:            getCount,
    fetchBatch:          fetchBatch,
    fetchSupplyChannels: fetchSupplyChannels
};
