'use strict';

var shopifyApi = require('*/cartridge/scripts/migration/core/shopifyApi');

var PROFILE_PAGE_SIZE = 25;
var ZONE_PAGE_SIZE    = 25;
var METHOD_PAGE_SIZE  = 25;

var DELIVERY_PROFILES_QUERY = ''
    + 'query AccDeliveryProfiles($cursor: String) {'
    + '  deliveryProfiles(first: ' + PROFILE_PAGE_SIZE + ', after: $cursor) {'
    + '    pageInfo { hasNextPage endCursor }'
    + '    nodes {'
    + '      id name'
    + '      profileLocationGroups {'
    + '        locationGroupZones(first: ' + ZONE_PAGE_SIZE + ') {'
    + '          nodes {'
    + '            zone { id name }'
    + '            methodDefinitions(first: ' + METHOD_PAGE_SIZE + ') {'
    + '              nodes {'
    + '                id name active description'
    + '                rateProvider {'
    + '                  ... on DeliveryRateDefinition {'
    + '                    price { amount currencyCode }'
    + '                  }'
    + '                }'
    + '              }'
    + '            }'
    + '          }'
    + '        }'
    + '      }'
    + '    }'
    + '  }'
    + '}';

function sanitizeKey(str) {
    return String(str || 'shipping').replace(/[^A-Za-z0-9_-]/g, '_').substring(0, 256);
}

function gidToId(gid) {
    if (!gid) return '';
    var parts = String(gid).split('/');
    return parts[parts.length - 1] || String(gid);
}

function moneyFromRate(rateProvider, fallbackCurrency) {
    var priceVal = 0;
    var currency = fallbackCurrency || 'USD';
    if (rateProvider && rateProvider.price) {
        priceVal = parseFloat(String(rateProvider.price.amount)) || 0;
        currency = rateProvider.price.currencyCode || currency;
    }
    return {
        centAmount:     Math.round(priceVal * 100),
        currencyCode:   currency,
        fractionDigits: 2
    };
}

function buildMethod(id, key, name, active, price) {
    return {
        id:            id,
        key:           key,
        name:          name,
        active:        active !== false,
        isDefault:     false,
        localizedName: { 'en-US': name },
        zoneRates:     [{
            shippingRates: [{ price: price }]
        }]
    };
}

function methodDefinitionToCtpMethod(profile, zone, methodDef, shopCurrency) {
    var methodId   = gidToId(methodDef.id);
    var methodName = methodDef.name || methodDef.description || methodId;
    var key        = sanitizeKey('shopify-sm-' + methodId);
    var price      = moneyFromRate(methodDef.rateProvider, shopCurrency);

    return buildMethod(methodId, key, methodName, methodDef.active, price);
}

function flattenDeliveryProfiles(profiles, shopCurrency) {
    var methods = [];
    var pi;
    var gi;
    var zi;
    var mi;

    for (pi = 0; pi < profiles.length; pi++) {
        var profile = profiles[pi];
        var groups  = profile.profileLocationGroups || [];

        for (gi = 0; gi < groups.length; gi++) {
            var group = groups[gi];
            var zones = (group.locationGroupZones && group.locationGroupZones.nodes)
                ? group.locationGroupZones.nodes
                : [];

            for (zi = 0; zi < zones.length; zi++) {
                var lgz    = zones[zi];
                var zone   = lgz.zone || {};
                var defs   = (lgz.methodDefinitions && lgz.methodDefinitions.nodes)
                    ? lgz.methodDefinitions.nodes
                    : [];

                for (mi = 0; mi < defs.length; mi++) {
                    methods.push(methodDefinitionToCtpMethod(profile, zone, defs[mi], shopCurrency));
                }
            }
        }
    }

    return methods;
}

/**
 * Modern Shopify stores expose shipping methods via delivery profiles (GraphQL).
 * Legacy REST shipping_zones only returns price/weight rates and misses profile methods.
 * @returns {Array}
 */
function fetchDeliveryProfileMethods() {
    var profiles = [];
    var cursor   = null;
    var hasNext  = true;
    var shopCurrency = 'USD';

    try {
        var shop = shopifyApi.getShop();
        if (shop && shop.currency) {
            shopCurrency = shop.currency;
        }
    } catch (e1) { /* use USD */ }

    while (hasNext) {
        var data = shopifyApi.graphql(DELIVERY_PROFILES_QUERY, { cursor: cursor });
        var conn = data.deliveryProfiles || {};
        var nodes = conn.nodes || [];
        var ni;

        for (ni = 0; ni < nodes.length; ni++) {
            profiles.push(nodes[ni]);
        }

        hasNext = !!(conn.pageInfo && conn.pageInfo.hasNextPage);
        cursor  = hasNext ? conn.pageInfo.endCursor : null;
    }

    return flattenDeliveryProfiles(profiles, shopCurrency);
}

function rateToCtpMethod(zone, rate) {
    var zoneId   = zone.id || 'zone';
    var rateId   = rate.id || rate.name;
    var key      = sanitizeKey((zone.name || 'zone') + '-' + (rate.name || rateId));
    var priceVal = 0;
    if (rate.price !== undefined && rate.price !== null) {
        priceVal = parseFloat(String(rate.price)) || 0;
    }

    return buildMethod(
        String(zoneId) + '-' + String(rateId),
        key,
        rate.name || key,
        true,
        {
            centAmount:     Math.round(priceVal * 100),
            currencyCode:   'USD',
            fractionDigits: 2
        }
    );
}

function carrierToCtpMethod(zone, carrier) {
    var zoneId = zone.id || 'zone';
    var cId    = carrier.id || carrier.carrier_service_id || carrier.name;
    var name   = carrier.name || carrier.carrier_service_type || ('Carrier ' + cId);
    var key    = sanitizeKey((zone.name || 'zone') + '-carrier-' + name);

    return buildMethod(
        String(zoneId) + '-carrier-' + String(cId),
        key,
        name,
        true,
        { centAmount: 0, currencyCode: 'USD', fractionDigits: 2 }
    );
}

function zonesToMethods(zones) {
    var methods = [];
    var zi;
    var ri;

    for (zi = 0; zi < zones.length; zi++) {
        var zone = zones[zi];

        var priceRates = zone.price_based_shipping_rates || [];
        for (ri = 0; ri < priceRates.length; ri++) {
            methods.push(rateToCtpMethod(zone, priceRates[ri]));
        }

        var weightRates = zone.weight_based_shipping_rates || [];
        for (ri = 0; ri < weightRates.length; ri++) {
            methods.push(rateToCtpMethod(zone, weightRates[ri]));
        }

        var carriers = zone.carrier_shipping_rate_providers || [];
        for (ri = 0; ri < carriers.length; ri++) {
            methods.push(carrierToCtpMethod(zone, carriers[ri]));
        }
    }

    return methods;
}

/**
 * Legacy REST shipping zones — kept as fallback for older store setups.
 * @returns {Array}
 */
function fetchLegacyZoneMethods() {
    var zones = shopifyApi.fetchAll('/shipping_zones.json', 'shipping_zones');
    return zonesToMethods(zones);
}

/**
 * Prefer delivery-profile methods; fall back to legacy REST only when GraphQL returns empty.
 * @returns {Array}
 */
function fetchAllMethods() {
    var graphqlError   = null;
    var profileMethods = [];

    try {
        profileMethods = fetchDeliveryProfileMethods();
    } catch (e) {
        graphqlError = e.message || String(e);
    }

    if (profileMethods.length) {
        return profileMethods;
    }

    if (graphqlError) {
        throw new Error(graphqlError);
    }

    return fetchLegacyZoneMethods();
}

/**
 * @returns {number}
 */
function getCount() {
    return fetchAllMethods().length;
}

/**
 * @param {number} offset
 * @param {number} limit
 * @returns {{ results: Array, total: number }}
 */
function fetchBatch(offset, limit) {
    var all   = fetchAllMethods();
    var start = offset || 0;
    var lim   = limit || 50;
    return {
        results: all.slice(start, start + lim),
        total:   all.length
    };
}

/**
 * @param {string} keyOrId
 * @returns {Object|null}
 */
function fetchByKeyOrId(keyOrId) {
    var batch = fetchAll();
    var id    = String(keyOrId || '').trim();
    var i;
    for (i = 0; i < batch.methods.length; i++) {
        var m = batch.methods[i];
        if (m.key === id || m.id === id) return m;
    }
    return null;
}

/**
 * @returns {{ methods: Array, total: number }}
 */
function fetchAll() {
    var methods = fetchAllMethods();
    return { methods: methods, total: methods.length };
}

module.exports = {
    getCount:       getCount,
    fetchBatch:     fetchBatch,
    fetchByKeyOrId: fetchByKeyOrId,
    fetchAll:       fetchAll
};
