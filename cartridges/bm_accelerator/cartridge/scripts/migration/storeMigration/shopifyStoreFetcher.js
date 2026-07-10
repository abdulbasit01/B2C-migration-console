'use strict';

var shopifyApi = require('*/cartridge/scripts/migration/core/shopifyApi');

function exportKeySafe(key) {
    return String(key || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function locationToStore(loc) {
    return {
        id:               String(loc.id),
        key:              'shopify-loc-' + loc.id,
        name:             { en: loc.name || ('Location ' + loc.id) },
        countries:        loc.country_code ? [loc.country_code] : [],
        supplyChannels:   [{ id: String(loc.id) }]
    };
}

function locationToChannel(loc) {
    return {
        id:      String(loc.id),
        key:     'shopify-loc-' + loc.id,
        address: {
            streetName:           loc.address1 || '',
            additionalStreetInfo: loc.address2 || '',
            city:                 loc.city || '',
            postalCode:           loc.zip || '',
            country:              loc.country_code || '',
            state:                loc.province_code || loc.province || '',
            phone:                loc.phone || ''
        }
    };
}

/**
 * @returns {Array}
 */
function fetchAllCtpStores() {
    var locations = shopifyApi.fetchMerchantLocations();
    var out       = [];
    var i;
    for (i = 0; i < locations.length; i++) {
        out.push(locationToStore(locations[i]));
    }
    return out;
}

/**
 * @returns {Object.<string, Object>}
 */
function fetchChannelMap() {
    var locations = shopifyApi.fetchMerchantLocations();
    var map       = {};
    var i;
    for (i = 0; i < locations.length; i++) {
        map[String(locations[i].id)] = locationToChannel(locations[i]);
    }
    return map;
}

/**
 * @param {number} offset
 * @param {number} [limit]
 * @returns {{ results: Array, total: number }}
 */
function fetchBatch(offset, limit) {
    var all    = fetchAllCtpStores();
    var lim    = limit || 500;
    var start  = offset || 0;
    var slice  = all.slice(start, start + lim);
    return { results: slice, total: all.length };
}

function filterStoresByRefs(stores, refs) {
    if (!refs || !refs.length) return stores || [];
    var refSet = {};
    var i;
    for (i = 0; i < refs.length; i++) {
        refSet[String(refs[i])] = true;
    }
    var out = [];
    for (i = 0; i < stores.length; i++) {
        var store = stores[i];
        var ref   = store.key || store.id || '';
        if (refSet[ref] || (store.id && refSet[store.id]) || (store.key && refSet[store.key])) {
            out.push(store);
        }
    }
    return out;
}

function storeMatchesRef(store, refSet) {
    if (!refSet) return true;
    var ref = store.key || store.id || '';
    return !!(refSet[ref] || (store.id && refSet[store.id]) || (store.key && refSet[store.key]));
}

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

function hasAddress(channel) {
    var addr = channel && channel.address;
    return !!(addr && (addr.country || addr.city || addr.streetName));
}

function getLocalized(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return obj.en || obj['en-US'] || obj.default || '';
}

function getFullStoreSummary() {
    return { storeCount: fetchAllCtpStores().length };
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
