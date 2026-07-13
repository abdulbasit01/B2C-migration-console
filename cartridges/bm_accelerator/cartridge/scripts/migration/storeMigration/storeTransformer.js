'use strict';

var registry = require('*/cartridge/scripts/migration/core/dataSourceRegistry');
var sourceAttrIds = require('*/cartridge/scripts/migration/core/sourceAttrIds');
var fetcher  = registry.getFetcher('store');

function getLocalized(obj) {
    return fetcher.getLocalized(obj);
}

function sanitizeStoreId(str) {
    if (!str) return '';
    return String(str)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 60);
}

function buildAddressLine(addr) {
    if (!addr) return '';
    var parts = [];
    if (addr.streetNumber) parts.push(addr.streetNumber);
    if (addr.streetName) parts.push(addr.streetName);
    if (!parts.length && addr.additionalStreetInfo) {
        parts.push(addr.additionalStreetInfo);
    }
    return parts.join(' ').trim();
}

function stateCode(addr) {
    if (!addr || !addr.state) return '';
    var state = String(addr.state).trim();
    if (state.length <= 3) return state.toUpperCase();
    return state;
}

function parseGeoLocation(geo) {
    if (!geo || geo.type !== 'Point' || !geo.coordinates || geo.coordinates.length < 2) {
        return { latitude: '', longitude: '' };
    }
    return {
        longitude: String(geo.coordinates[0]),
        latitude:  String(geo.coordinates[1])
    };
}

function firstCountry(store) {
    var countries = store && store.countries ? store.countries : [];
    return countries.length ? countries[0] : '';
}

function buildCustomAttributes(storeId, country, store, channel) {
    var prefix = sourceAttrIds.getPrefix(registry.getPlatformId());
    var attrs  = {
        countryCodeValue: country || '',
        inventoryListId:  'inventory_m_store_' + storeId
    };
    attrs[prefix + 'StoreId']  = (store && store.id) ? store.id : '';
    attrs[prefix + 'StoreKey']  = (store && store.key) ? store.key : '';
    if (channel) {
        attrs[prefix + 'ChannelId']  = channel.id || '';
        attrs[prefix + 'ChannelKey'] = channel.key || '';
    }
    return attrs;
}

/**
 * Transform one CTP store into an SFCC store record.
 * Address/geo enriched from linked supply/distribution channels when available.
 * @param {Object} store
 * @param {Object} channelById
 * @param {string} [storeIdOverride]
 * @returns {Object|null}
 */
function transformStore(store, channelById, storeIdOverride) {
    if (!store) return null;

    var storeKey = store.key || store.id || '';
    var storeId  = storeIdOverride || sanitizeStoreId(storeKey);
    if (!storeId) return null;

    var name         = getLocalized(store.name) || storeId;
    var country      = firstCountry(store);
    var channel      = fetcher.findLinkedChannel(store, channelById);
    var addr         = channel && channel.address ? channel.address : null;
    var geo          = channel ? parseGeoLocation(channel.geoLocation) : { latitude: '', longitude: '' };

    if (addr && addr.country) {
        country = addr.country;
    }

    return {
        storeId:                   storeId,
        name:                      name,
        address1:                  addr ? buildAddressLine(addr) : '',
        city:                      addr ? (addr.city || '') : '',
        postalCode:                addr ? (addr.postalCode || '') : '',
        stateCode:                 addr ? stateCode(addr) : '',
        countryCode:               country,
        email:                     addr ? (addr.email || '') : '',
        phone:                     addr ? (addr.phone || addr.mobile || '') : '',
        fax:                       '',
        latitude:                  geo.latitude,
        longitude:                 geo.longitude,
        storeLocatorEnabled:       true,
        demandwarePosEnabled:      false,
        posEnabled:                false,
        customAttributes:          buildCustomAttributes(storeId, country, store, channel)
    };
}

/**
 * Build store records from CTP stores.
 * @param {Array} stores
 * @param {Object} channelById
 * @returns {Array}
 */
function buildStoreRecords(stores, channelById) {
    var out = [];
    var i;

    for (i = 0; i < stores.length; i++) {
        var record = transformStore(stores[i], channelById, null);
        if (record) out.push(record);
    }

    return out;
}

function toMigrationRef(store) {
    if (!store) return '';
    return store.key || store.id || '';
}

/**
 * Lightweight summary for the migration UI checklist.
 * @param {Object} store
 * @returns {Object}
 */
function toSummary(store) {
    var storeId = sanitizeStoreId(store.key || store.id);
    var countries = store.countries || [];
    return {
        ref:         toMigrationRef(store),
        key:         store.key || '',
        id:          store.id || '',
        name:        getLocalized(store.name) || storeId,
        countries:   countries.join(', '),
        sfccStoreId: storeId
    };
}

module.exports = {
    transformStore:    transformStore,
    buildStoreRecords: buildStoreRecords,
    sanitizeStoreId:   sanitizeStoreId,
    toMigrationRef:    toMigrationRef,
    toSummary:         toSummary
};
