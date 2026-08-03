'use strict';

var bigcommerceApi = require('*/cartridge/scripts/migration/core/bigcommerceApi');
var transformer    = require('*/cartridge/scripts/migration/pricebookMigration/pricebookTransformer');

var _shopCurrency = null;

function getShopCurrency() {
    if (_shopCurrency) return _shopCurrency;
    var store = bigcommerceApi.getStore();
    _shopCurrency = (store && store.currency) ? String(store.currency) : 'USD';
    return _shopCurrency;
}

function exportKeySafe(key) {
    return String(key || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function variantToPrice(variant, currency) {
    if (!variant || variant.id == null) return null;
    var price = variant.sale_price != null && variant.sale_price !== ''
        ? variant.sale_price
        : variant.price;
    if (price === null || price === undefined || price === '') return null;
    var productId = String(variant.id);
    return {
        productId: productId,
        sku:       variant.sku ? String(variant.sku) : productId,
        value:     bigcommerceApi.priceToMoney(price, currency)
    };
}

function productBaseToPrice(product, currency) {
    if (!product || product.id == null) return null;
    var price = product.sale_price != null && product.sale_price !== ''
        ? product.sale_price
        : product.price;
    if (price === null || price === undefined || price === '') return null;
    var productId = String(product.id);
    return {
        productId: productId,
        sku:       product.sku ? String(product.sku) : productId,
        value:     bigcommerceApi.priceToMoney(price, currency)
    };
}

function collectVariantPrices(products, currency) {
    var out = [];
    var pi;
    for (pi = 0; pi < products.length; pi++) {
        var product  = products[pi];
        var variants = product.variants || [];
        if (!variants.length) {
            var base = productBaseToPrice(product, currency);
            if (base) out.push(base);
            continue;
        }
        var vi;
        for (vi = 0; vi < variants.length; vi++) {
            var row = variantToPrice(variants[vi], currency);
            if (row) out.push(row);
        }
    }
    return out;
}

function fetchAllProducts() {
    return bigcommerceApi.fetchAll('/catalog/products', null, {
        version:     'v3',
        limit:       250,
        queryParams: 'include=variants'
    });
}

function buildWhereClause(currency, channelId, aggregate) {
    return '';
}

function pricesBaseQs() {
    return '?';
}

/**
 * @param {string} currency
 * @param {string} [channelId]
 * @param {boolean} [aggregate]
 * @returns {number}
 */
function getCount(currency, channelId, aggregate) {
    var products = fetchAllProducts();
    return collectVariantPrices(products, currency || getShopCurrency()).length;
}

/**
 * @param {number} offset
 * @param {number} limit
 * @param {string} [currency]
 * @param {string} [channelId]
 * @param {boolean} [aggregate]
 * @param {string} [sortField]
 * @returns {{ results: Array, total: number }}
 */
function fetchBatch(offset, limit, currency, channelId, aggregate, sortField) {
    var cur      = currency || getShopCurrency();
    var products = fetchAllProducts();
    var all      = collectVariantPrices(products, cur);
    var total    = all.length;
    var start    = offset || 0;
    var lim      = limit || 500;

    if (sortField === 'sku') {
        all.sort(function (a, b) {
            return a.sku < b.sku ? -1 : (a.sku > b.sku ? 1 : 0);
        });
    }

    return {
        results: all.slice(start, start + lim),
        total:   total
    };
}

/**
 * BigCommerce has no distribution channels for catalog prices — return store currency.
 * @returns {Array}
 */
function fetchDistributionChannels() {
    return [{
        id:   'bc-default',
        key:  'bc-default',
        name: 'BigCommerce store (' + getShopCurrency() + ')'
    }];
}

function readSessionMap(key) {
    try {
        /* global session */
        return JSON.parse(String(session.custom[key] || '{}'));
    } catch (e) {
        return {};
    }
}

function writeSessionMap(key, obj) {
    /* global session */
    session.custom[key] = JSON.stringify(obj || {});
}

function buildTargetsFromMaps(aggByCurrency) {
    var targets    = [];
    var currencies = Object.keys(aggByCurrency).sort();
    var ci;
    for (ci = 0; ci < currencies.length; ci++) {
        var currency = currencies[ci];
        targets.push({
            exportKey:  'agg_' + exportKeySafe(currency),
            label:      currency + ' — BigCommerce catalog',
            subLabel:   'Variant prices from BigCommerce products',
            currency:   currency,
            channelId:  'all',
            channelKey: '',
            aggregate:  true,
            priceCount: aggByCurrency[currency],
            source:     'standalone'
        });
    }
    return targets;
}

var SESS = {
    offset: 'pbDisc_bc_offset',
    total:  'pbDisc_bc_total',
    agg:    'pbDisc_bc_agg'
};

function clearStandaloneDiscovery() {
    session.custom[SESS.offset] = '0';
    session.custom[SESS.total]  = '';
    writeSessionMap(SESS.agg, {});
}

/**
 * @param {number} offset
 * @param {boolean} reset
 * @returns {Object}
 */
function discoverStandaloneStep(offset, reset) {
    if (reset || offset === 0) {
        clearStandaloneDiscovery();
    }

    var cur = getShopCurrency();
    var agg = readSessionMap(SESS.agg);
    if (!agg[cur]) agg[cur] = 0;

    var products = fetchAllProducts();
    var prices   = collectVariantPrices(products, cur);
    agg[cur] = prices.length;
    writeSessionMap(SESS.agg, agg);

    clearStandaloneDiscovery();
    return {
        done:       true,
        nextOffset: prices.length,
        scanned:    prices.length,
        total:      prices.length,
        standalone: buildTargetsFromMaps(agg)
    };
}

function discoverPricebookTargets() {
    return discoverStandaloneStep(0, true).standalone || [];
}

/**
 * Embedded prices are the same as variant prices for BigCommerce.
 */
function discoverEmbeddedStep(offset, reset) {
    var result = discoverStandaloneStep(offset, reset);
    return {
        done:       true,
        nextOffset: result.nextOffset,
        scanned:    result.scanned,
        total:      result.total,
        embedded:   result.standalone
    };
}

/**
 * Same contract as ctpEmbeddedPriceFetcher.fetchPriceRecordsBatch.
 * @param {number} offset
 * @param {number} limit
 * @param {string} [currency]
 * @param {string} [channelId]
 * @param {boolean} [aggregate]
 * @returns {{ records: Array, total: number, nextOffset: number, done: boolean }}
 */
function fetchPriceRecordsBatch(offset, limit, currency, channelId, aggregate) {
    var batch      = fetchBatch(offset, limit || 500, currency, channelId, aggregate, 'sku');
    var results    = batch.results || [];
    var total      = batch.total || 0;
    var start      = offset || 0;
    var nextOffset = start + results.length;
    var records    = [];
    var i;

    for (i = 0; i < results.length; i++) {
        var rec = transformer.transformEntry(results[i]);
        if (rec) records.push(rec);
    }

    return {
        records:    records,
        total:      total,
        nextOffset: nextOffset,
        done:       nextOffset >= total || results.length === 0
    };
}

function getPriceCount(currency, channelId, aggregate) {
    return getCount(currency, channelId, aggregate);
}

function discoverEmbeddedPricebookTargets() {
    return discoverEmbeddedStep(0, true).embedded || [];
}

module.exports = {
    getCount:                         getCount,
    getPriceCount:                    getPriceCount,
    fetchBatch:                       fetchBatch,
    fetchPriceRecordsBatch:           fetchPriceRecordsBatch,
    fetchDistributionChannels:        fetchDistributionChannels,
    discoverPricebookTargets:         discoverPricebookTargets,
    discoverStandaloneStep:           discoverStandaloneStep,
    discoverEmbeddedStep:             discoverEmbeddedStep,
    discoverEmbeddedPricebookTargets: discoverEmbeddedPricebookTargets
};
