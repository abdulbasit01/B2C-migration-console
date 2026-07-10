'use strict';

var shopifyApi            = require('*/cartridge/scripts/migration/core/shopifyApi');
var shopifyProductId      = require('*/cartridge/scripts/migration/core/shopifyProductId');
var shopifyProductCatalog = require('*/cartridge/scripts/migration/core/shopifyProductCatalog');

var _countCache = {};
var _locationIdsCache = null;

function normalizeLocationId(locationId) {
    if (!locationId || locationId === 'all') return '';
    return String(locationId);
}

function locationToChannel(loc) {
    return {
        id:   String(loc.id),
        key:  'loc-' + loc.id,
        name: loc.name || ('Location ' + loc.id)
    };
}

/**
 * All active Shopify locations for inventory lists (includes legacy locations).
 * Store migration still uses fetchMerchantLocations() which hides legacy entries.
 * @returns {Array}
 */
function fetchInventoryLocations() {
    return shopifyApi.fetchInventoryLocations();
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
    _locationIdsCache = ids;
    _countCache       = {};
    shopifyProductCatalog.clearCatalogCache();
    return out;
}

/**
 * Active Shopify location IDs (cached until channels are reloaded).
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
 * Shopify requires location_ids or inventory_item_ids on inventory_levels — unfiltered calls return 422.
 * @param {string} [locationId] - single location or empty for all active locations
 * @returns {string} query fragment e.g. location_ids=123 or ''
 */
function locationIdsQuery(locationId) {
    var locId = normalizeLocationId(locationId);
    if (locId) {
        return 'location_ids=' + encodeURIComponent(locId);
    }
    var ids = getActiveLocationIds();
    if (!ids.length) {
        return '';
    }
    return 'location_ids=' + ids.map(encodeURIComponent).join(',');
}

function apiError(res, label) {
    var detail = '';
    if (res.data && res.data.errors) {
        detail = ': ' + JSON.stringify(res.data.errors).substring(0, 300);
    } else if (res.text) {
        detail = ': ' + res.text.substring(0, 300);
    }
    throw new Error(label + ' (' + res.status + ')' + detail);
}

function inventoryItemMap(ids) {
    if (!ids || !ids.length) return {};
    var map   = {};
    var i;
    var chunk = [];
    for (i = 0; i < ids.length; i++) {
        chunk.push(ids[i]);
        if (chunk.length >= 100 || i === ids.length - 1) {
            var res   = shopifyApi.get('/inventory_items.json?ids=' + chunk.join(','));
            var items = res.data.inventory_items || [];
            var j;
            for (j = 0; j < items.length; j++) {
                map[String(items[j].id)] = items[j];
            }
            chunk = [];
        }
    }
    return map;
}

/**
 * Resolve Shopify variant ID for an inventory row.
 * @param {string} inventoryItemId
 * @param {Object} item
 * @returns {string}
 */
function resolveVariantId(inventoryItemId, item) {
    if (item && item.variant_id) {
        return String(item.variant_id);
    }
    var catalog = shopifyProductCatalog.lookupByInventoryItemId(inventoryItemId);
    return catalog && catalog.variantId ? catalog.variantId : '';
}

/**
 * @param {Object} level
 * @param {Object} [itemMap]
 * @returns {Object|null}
 */
function mapLevel(level, itemMap) {
    var invItemId = String(level.inventory_item_id);
    var item      = (itemMap && itemMap[invItemId]) || {};
    var variantId = resolveVariantId(invItemId, item);
    var productId = shopifyProductId.toProductId({ variantId: variantId });
    if (!productId) {
        return null;
    }

    return {
        sku:               productId,
        productId:         productId,
        availableQuantity: typeof level.available === 'number' ? level.available : 0,
        quantityOnStock:   typeof level.available === 'number' ? level.available : 0,
        lastModifiedAt:    level.updated_at || new Date().toISOString(),
        supplyChannel:     level.location_id ? { id: String(level.location_id) } : null
    };
}

function isExportableLevel(level) {
    return mapLevel(level, null) !== null;
}

function countLevels(locationId) {
    var cacheKey = locationId || 'all';
    if (_countCache[cacheKey] !== undefined) {
        return _countCache[cacheKey];
    }

    var qs = locationIdsQuery(locationId);
    if (!qs) {
        _countCache[cacheKey] = 0;
        return 0;
    }

    shopifyProductCatalog.getByInventoryItemId();

    var total    = 0;
    var pageInfo = null;
    var basePath = '/inventory_levels.json?limit=250&' + qs;

    do {
        var url = shopifyApi.adminBase() + basePath;
        if (pageInfo) {
            url = shopifyApi.adminBase() + '/inventory_levels.json?limit=250&page_info=' + pageInfo;
        }
        var res = shopifyApi.send('GET', url, shopifyApi.authHeaders());
        if (res.status >= 400) {
            apiError(res, 'Shopify inventory count failed');
        }
        var batch = res.data.inventory_levels || [];
        var i;
        for (i = 0; i < batch.length; i++) {
            if (isExportableLevel(batch[i])) {
                total++;
            }
        }
        pageInfo = shopifyApi.parseNextPageInfo(res.link);
    } while (pageInfo);

    _countCache[cacheKey] = total;
    return total;
}

/**
 * @param {string} [supplyChannelId]
 * @returns {number}
 */
function getCount(supplyChannelId) {
    return countLevels(normalizeLocationId(supplyChannelId));
}

/**
 * @param {number} offset - exportable-record offset (not raw API row index)
 * @param {number} limit
 * @param {string} [supplyChannelId]
 * @param {string} [sortField]
 * @returns {{ results: Array, total: number, streamOffset: number }}
 */
function fetchBatch(offset, limit, supplyChannelId, sortField) {
    var qs = locationIdsQuery(supplyChannelId);
    if (!qs) {
        return { results: [], total: 0, streamOffset: 0 };
    }

    shopifyProductCatalog.getByInventoryItemId();

    var total           = getCount(supplyChannelId);
    var start           = offset || 0;
    var lim             = limit || 500;
    var exportableIndex = 0;
    var collected       = [];
    var pageInfo        = null;
    var basePath        = '/inventory_levels.json?limit=250&' + qs;
    var done            = false;

    do {
        var url = shopifyApi.adminBase() + basePath;
        if (pageInfo) {
            url = shopifyApi.adminBase() + '/inventory_levels.json?limit=250&page_info=' + pageInfo;
        }
        var res = shopifyApi.send('GET', url, shopifyApi.authHeaders());
        if (res.status >= 400) {
            apiError(res, 'Shopify inventory fetch failed');
        }
        var levels = res.data.inventory_levels || [];
        if (!levels.length) break;

        var ids = [];
        var i;
        for (i = 0; i < levels.length; i++) {
            ids.push(levels[i].inventory_item_id);
        }
        var itemMap = inventoryItemMap(ids);

        for (i = 0; i < levels.length; i++) {
            var mapped = mapLevel(levels[i], itemMap);
            if (!mapped) {
                continue;
            }
            if (exportableIndex < start) {
                exportableIndex++;
                continue;
            }
            collected.push(mapped);
            exportableIndex++;
            if (collected.length >= lim) {
                done = true;
                break;
            }
        }
        if (done) break;
        pageInfo = shopifyApi.parseNextPageInfo(res.link);
    } while (pageInfo);

    if (sortField === 'sku') {
        collected.sort(function (a, b) {
            return a.sku < b.sku ? -1 : (a.sku > b.sku ? 1 : 0);
        });
    }

    return { results: collected, total: total, streamOffset: exportableIndex };
}

module.exports = {
    getCount:            getCount,
    fetchBatch:          fetchBatch,
    fetchSupplyChannels: fetchSupplyChannels
};
