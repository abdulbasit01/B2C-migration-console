'use strict';

/**
 * Fetch stores from SAP Commerce Cloud OCC v2.
 *
 * Verified via GET /{baseSiteId}/stores?pageSize=&currentPage=&fields=FULL
 * (Postman test, 2026-07): omitting query/latitude/longitude returns every
 * store for the base site, paginated via pagination.totalResults. Unlike CTP,
 * address and geo-coordinates are embedded directly on each PointOfService —
 * there is no separate "channel" object to cross-reference, so this fetcher
 * treats every store as its own channel (self-referencing) to fit the shared
 * storeTransformer.js contract without modifying it.
 */

var sapApi = require('*/cartridge/scripts/migration/core/sapApi');
var Logger = require('dw/system/Logger');

var PAGE_SIZE = 50;

/**
 * Sanitize a value for use as a WebDAV/IMPEX export file-name fragment.
 * @param {string} key - raw value to sanitize
 * @returns {string} value with only [A-Za-z0-9_-] characters, defaulting to "default"
 */
function exportKeySafe(key) {
    return String(key || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Build a CTP-shaped address object from a SAP PointOfService's embedded address,
 * so the existing storeTransformer.js (buildAddressLine/stateCode/etc.) needs no changes.
 * @param {Object} addr - SAP PointOfService.address
 * @returns {Object} CTP-shaped address, or null if addr is falsy
 */
function toCtpShapedAddress(addr) {
    if (!addr) return null;
    return {
        streetName:           addr.line1 || '',
        additionalStreetInfo: addr.line2 || '',
        city:                 addr.town || '',
        postalCode:           addr.postalCode || '',
        country:              (addr.country && addr.country.isocode) || '',
        state:                (addr.region && addr.region.isocode) || '',
        phone:                addr.phone || '',
        email:                addr.email || ''
    };
}

/**
 * Build a CTP-shaped GeoJSON point from SAP's { latitude, longitude } pair,
 * so storeTransformer.js's parseGeoLocation() (which expects
 * { type: 'Point', coordinates: [lon, lat] }) works unmodified.
 * @param {Object} geoPoint - SAP PointOfService.geoPoint
 * @returns {Object|null} GeoJSON Point, or null if latitude/longitude are missing
 */
function toCtpShapedGeoLocation(geoPoint) {
    if (!geoPoint || geoPoint.latitude === undefined || geoPoint.longitude === undefined) return null;
    return {
        type:        'Point',
        coordinates: [geoPoint.longitude, geoPoint.latitude]
    };
}

/**
 * Normalize one SAP PointOfService into the shared { store, channel } shape
 * that ctpStoreFetcher.js / storeTransformer.js already expect.
 * @param {Object} pos - raw SAP PointOfService
 * @returns {{ store: Object, channel: Object }} the same store, normalized into both roles
 */
function posToStoreAndChannel(pos) {
    var ref = String(pos.name || pos.displayName || '').trim();

    var store = {
        id:             ref,
        key:            ref,
        name:           { en: pos.displayName || ref },
        countries:      (pos.address && pos.address.country && pos.address.country.isocode) ? [pos.address.country.isocode] : [],
        supplyChannels: [{ id: ref }]
    };

    var channel = {
        id:          ref,
        key:         ref,
        address:     toCtpShapedAddress(pos.address),
        geoLocation: toCtpShapedGeoLocation(pos.geoPoint)
    };

    return { store: store, channel: channel };
}

/**
 * Fetch one page of SAP stores.
 * @param {number} offset - zero-based result offset
 * @param {number} [limit] - page size, defaults to PAGE_SIZE
 * @returns {{ results: Array, total: number }} this page's stores and the overall total
 */
function fetchBatch(offset, limit) {
    var lim         = limit || PAGE_SIZE;
    var currentPage = Math.floor((offset || 0) / lim);
    var res         = sapApi.get('/stores?pageSize=' + lim + '&currentPage=' + currentPage + '&fields=FULL');
    var stores      = (res.data && res.data.stores) || [];
    var total       = (res.data && res.data.pagination && res.data.pagination.totalResults !== undefined)
        ? res.data.pagination.totalResults
        : stores.length;

    var results = [];
    var i;
    for (i = 0; i < stores.length; i++) {
        results.push(posToStoreAndChannel(stores[i]).store);
    }

    return { results: results, total: total };
}

/**
 * Fetch all SAP stores (paginated).
 * @returns {Array} every store for the connected base site
 */
function fetchAllCtpStores() {
    var out    = [];
    var offset = 0;
    var batch;

    do {
        batch = fetchBatch(offset, PAGE_SIZE);
        out   = out.concat(batch.results);
        offset += batch.results.length;
    } while (batch.results.length === PAGE_SIZE && offset < batch.total);

    return out;
}

/**
 * Fetch all SAP stores indexed by ref (self-referencing "channel" map —
 * each store carries its own address/geo, so there's no separate channel resource).
 * @returns {Object.<string, Object>} channel-shaped objects keyed by store ref
 */
function fetchChannelMap() {
    var map    = {};
    var offset = 0;
    var lim    = PAGE_SIZE;
    var currentPage;
    var res;
    var stores;
    var total;

    do {
        currentPage = Math.floor(offset / lim);
        res    = sapApi.get('/stores?pageSize=' + lim + '&currentPage=' + currentPage + '&fields=FULL');
        stores = (res.data && res.data.stores) || [];
        total  = (res.data && res.data.pagination && res.data.pagination.totalResults !== undefined)
            ? res.data.pagination.totalResults
            : stores.length;

        var i;
        for (i = 0; i < stores.length; i++) {
            var pair = posToStoreAndChannel(stores[i]);
            map[pair.channel.id] = pair.channel;
        }
        offset += stores.length;
    } while (stores.length === lim && offset < total);

    return map;
}

/**
 * Look up the channel (self-referencing, for SAP) linked to a store via its supplyChannels refs.
 * @param {Object} store - normalized store record
 * @param {Object} channelById - map built by fetchChannelMap()
 * @returns {Object|null} the linked channel, or null if none found
 */
function findLinkedChannel(store, channelById) {
    if (!store || !channelById) return null;
    var refs = store.supplyChannels || [];
    var i;
    for (i = 0; i < refs.length; i++) {
        var ref = refs[i];
        var ch  = ref && ref.id ? channelById[ref.id] : null;
        if (ch) return ch;
    }
    return null;
}

/**
 * @param {Object} channel - channel-shaped object with an optional address
 * @returns {boolean} whether the channel has enough address data to be usable
 */
function hasAddress(channel) {
    var addr = channel && channel.address;
    return !!(addr && (addr.country || addr.city || addr.streetName));
}

/**
 * @param {Object} obj - localized-string-shaped object, e.g. { en: '...' }
 * @returns {string} the English (or default) value, or '' if none found
 */
function getLocalized(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return obj.en || obj['en-US'] || obj.default || '';
}

/**
 * @param {Object} store - normalized store record
 * @param {Object.<string, boolean>} refSet - set of refs to match against
 * @returns {boolean} whether the store's key/id is present in refSet
 */
function storeMatchesRef(store, refSet) {
    if (!refSet) return true;
    var ref = store.key || store.id || '';
    return !!(refSet[ref] || (store.id && refSet[store.id]) || (store.key && refSet[store.key]));
}

/**
 * @param {Array} stores - normalized store records
 * @param {Array<string>} refs - keys/ids to filter down to
 * @returns {Array} stores whose key or id appears in refs (all stores if refs is empty)
 */
function filterStoresByRefs(stores, refs) {
    if (!refs || !refs.length) return stores || [];
    var refSet = {};
    var i;
    for (i = 0; i < refs.length; i++) {
        refSet[String(refs[i])] = true;
    }
    var out = [];
    for (i = 0; i < stores.length; i++) {
        if (storeMatchesRef(stores[i], refSet)) out.push(stores[i]);
    }
    return out;
}

/**
 * Summary for migration count endpoints.
 * @returns {{ storeCount: number }} total number of SAP stores available to migrate
 */
function getFullStoreSummary() {
    try {
        return { storeCount: fetchAllCtpStores().length };
    } catch (e) {
        Logger.error('sapStoreFetcher.getFullStoreSummary failed: {0}', e.message || String(e));
        throw e;
    }
}

module.exports = {
    fetchAllCtpStores:   fetchAllCtpStores,
    fetchBatch:          fetchBatch,
    fetchChannelMap:     fetchChannelMap,
    findLinkedChannel:   findLinkedChannel,
    filterStoresByRefs:  filterStoresByRefs,
    storeMatchesRef:     storeMatchesRef,
    getFullStoreSummary: getFullStoreSummary,
    exportKeySafe:       exportKeySafe,
    hasAddress:          hasAddress,
    getLocalized:        getLocalized
};
