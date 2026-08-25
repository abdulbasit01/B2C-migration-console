'use strict';

var bigcommerceApi = require('*/cartridge/scripts/migration/core/bigcommerceApi');

function sanitizeKey(str) {
    return String(str || 'shipping').replace(/[^A-Za-z0-9_-]/g, '_').substring(0, 256);
}

function getStoreCurrency() {
    try {
        var store = bigcommerceApi.getStore();
        if (store && store.currency) return String(store.currency);
    } catch (e) { /* use USD */ }
    return 'USD';
}

function moneyFromAmount(amount, currency) {
    var priceVal = parseFloat(String(amount != null ? amount : '0')) || 0;
    return {
        centAmount:     Math.round(priceVal * 100),
        currencyCode:   currency || 'USD',
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

/**
 * Extract a representative flat price from a BigCommerce shipping method settings object.
 * @param {Object} method
 * @param {string} currency
 * @returns {Object}
 */
function priceFromMethod(method, currency) {
    var settings = method && method.settings ? method.settings : {};
    var amount   = 0;

    if (settings.rate != null) {
        amount = settings.rate;
    } else if (settings.default_cost != null) {
        amount = settings.default_cost;
    } else if (settings.range && settings.range.length) {
        amount = settings.range[0].shipping_cost != null
            ? settings.range[0].shipping_cost
            : 0;
    } else if (method.type === 'freeshipping') {
        amount = 0;
    }

    return moneyFromAmount(amount, currency);
}

function methodToCtp(zone, method, currency) {
    var zoneId   = zone && zone.id != null ? String(zone.id) : 'zone';
    var methodId = method && method.id != null ? String(method.id) : 'method';
    var name     = (method && method.name) || ('Shipping ' + methodId);
    var key      = sanitizeKey('bc-sm-' + zoneId + '-' + methodId);
    var active   = method && method.enabled !== false;

    return buildMethod(
        zoneId + '-' + methodId,
        key,
        name,
        active,
        priceFromMethod(method, currency)
    );
}

/**
 * @returns {Array}
 */
function fetchAllMethods() {
    var currency = getStoreCurrency();
    var zones    = bigcommerceApi.fetchAll('/shipping/zones', null, {
        version: 'v2',
        limit:   250
    });
    var methods = [];
    var zi;

    for (zi = 0; zi < zones.length; zi++) {
        var zone = zones[zi];
        if (!zone || zone.id == null) continue;

        var zoneMethods = [];
        try {
            var res = bigcommerceApi.get(
                '/shipping/zones/' + encodeURIComponent(String(zone.id)) + '/methods',
                null,
                'v2'
            );
            zoneMethods = bigcommerceApi.extractList(res.data);
        } catch (e) {
            zoneMethods = [];
        }

        var mi;
        for (mi = 0; mi < zoneMethods.length; mi++) {
            methods.push(methodToCtp(zone, zoneMethods[mi], currency));
        }
    }

    return methods;
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
 * @returns {{ methods: Array, total: number }}
 */
function fetchAll() {
    var methods = fetchAllMethods();
    return { methods: methods, total: methods.length };
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

module.exports = {
    getCount:       getCount,
    fetchBatch:     fetchBatch,
    fetchByKeyOrId: fetchByKeyOrId,
    fetchAll:       fetchAll
};
