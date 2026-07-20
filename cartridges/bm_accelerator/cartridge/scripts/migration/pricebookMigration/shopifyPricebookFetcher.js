'use strict';

var shopifyApi    = require('*/cartridge/scripts/migration/core/shopifyApi');
var transformer   = require('*/cartridge/scripts/migration/pricebookMigration/pricebookTransformer');

var _shopCurrency = null;

function getShopCurrency() {
    if (_shopCurrency) return _shopCurrency;
    var shop = shopifyApi.getShop();
    _shopCurrency = shop.currency || 'USD';
    return _shopCurrency;
}

function exportKeySafe(key) {
    return String(key || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function variantToPrice(variant, currency) {
    if (!variant || !variant.id) return null;
    var price = variant.price;
    if (price === null || price === undefined || price === '') return null;
    var productId = String(variant.id);
    return {
        productId: productId,
        sku:       productId,
        value:     shopifyApi.priceToMoney(price, currency)
    };
}

function collectVariantPrices(products, currency) {
    var out = [];
    var pi;
    for (pi = 0; pi < products.length; pi++) {
        var variants = products[pi].variants || [];
        var vi;
        for (vi = 0; vi < variants.length; vi++) {
            var row = variantToPrice(variants[vi], currency);
            if (row) out.push(row);
        }
    }
    return out;
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
    var products = shopifyApi.fetchAll('/products.json', 'products', null, { limit: 250 });
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
    var products = shopifyApi.fetchAll('/products.json', 'products', null, { limit: 250 });
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
 * Shopify has no distribution channels — return shop currency as single target.
 * @returns {Array}
 */
function fetchDistributionChannels() {
    return [{
        id:   'shopify-default',
        key:  'shopify-default',
        name: 'Shopify store (' + getShopCurrency() + ')'
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
            label:      currency + ' — Shopify catalog',
            subLabel:   'Variant prices from Shopify products',
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
    offset: 'pbDisc_shopify_offset',
    total:  'pbDisc_shopify_total',
    agg:    'pbDisc_shopify_agg'
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

    var cur     = getShopCurrency();
    var agg     = readSessionMap(SESS.agg);
    if (!agg[cur]) agg[cur] = 0;

    var products = shopifyApi.fetchAll('/products.json', 'products', null, { limit: 250 });
    var prices   = collectVariantPrices(products, cur);
    agg[cur]       = prices.length;
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
 * Embedded prices are the same as variant prices for Shopify.
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
    getCount:                       getCount,
    getPriceCount:                  getPriceCount,
    fetchBatch:                     fetchBatch,
    fetchPriceRecordsBatch:         fetchPriceRecordsBatch,
    fetchDistributionChannels:      fetchDistributionChannels,
    discoverPricebookTargets:       discoverPricebookTargets,
    discoverStandaloneStep:         discoverStandaloneStep,
    discoverEmbeddedStep:           discoverEmbeddedStep,
    discoverEmbeddedPricebookTargets: discoverEmbeddedPricebookTargets
};
