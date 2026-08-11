'use strict';

/**
 * Fetch pricebook data from SAP Commerce Cloud OCC v2.
 * Price only exists embedded on each product (GET /products/search) — no
 * standalone-price resource and one currency per base site, so this one
 * fetcher covers both the 'pricebook' and 'pricebookEmbedded' registry keys.
 */

var sapApi      = require('*/cartridge/scripts/migration/core/sapApi');
var transformer = require('*/cartridge/scripts/migration/pricebookMigration/pricebookTransformer');

var PAGE_SIZE = 50;
var siteCurrencyCache = null;

/**
 * Sanitize a value for use as a WebDAV/IMPEX export file-name fragment.
 * @param {string} key - raw value to sanitize
 * @returns {string} value with only [A-Za-z0-9_-] characters, defaulting to "default"
 */
function exportKeySafe(key) {
    return String(key || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Resolve this base site's single currency from the first product's embedded price.
 * @returns {string} ISO currency code, cached after the first call
 */
function getSiteCurrency() {
    if (siteCurrencyCache) return siteCurrencyCache;
    var res      = sapApi.get('/products/search?pageSize=1&currentPage=0&fields=FULL');
    var products = (res.data && res.data.products) || [];
    siteCurrencyCache = (products.length && products[0].price && products[0].price.currencyIso) || 'USD';
    return siteCurrencyCache;
}

/**
 * Convert one SAP product's embedded price into the CTP-shaped price record
 * that the shared pricebookTransformer.js already expects.
 * @param {Object} product - raw SAP product from /products/search
 * @returns {Object|null} { productId, sku, value: { centAmount, currencyCode, fractionDigits } }, or null if no price
 */
function productToPrice(product) {
    if (!product || !product.code || !product.price || product.price.value === undefined || product.price.value === null) {
        return null;
    }
    var sku    = String(product.code);
    var amount = parseFloat(product.price.value) || 0;
    return {
        productId: sku,
        sku:       sku,
        value: {
            centAmount:     Math.round(amount * 100),
            currencyCode:   product.price.currencyIso || getSiteCurrency(),
            fractionDigits: 2
        }
    };
}

/**
 * Fetch every priced product, paginated via /products/search.
 * @returns {Array} CTP-shaped price records for every product with an embedded price
 */
function fetchAllPrices() {
    var all         = [];
    var offset      = 0;
    var lim         = PAGE_SIZE;
    var total       = null;
    var currentPage;
    var res;
    var products;
    var i;

    do {
        currentPage = Math.floor(offset / lim);
        res      = sapApi.get('/products/search?pageSize=' + lim + '&currentPage=' + currentPage + '&fields=FULL');
        products = (res.data && res.data.products) || [];
        if (total === null) {
            total = (res.data && res.data.pagination && res.data.pagination.totalResults !== undefined)
                ? res.data.pagination.totalResults
                : products.length;
        }
        for (i = 0; i < products.length; i++) {
            var rec = productToPrice(products[i]);
            if (rec) all.push(rec);
        }
        offset += products.length;
    } while (offset < total && products.length === lim);

    return all;
}

/**
 * SAP has one currency and no channels, so unlike other platforms this takes no params.
 * @returns {number} total number of priced products
 */
function getCount() {
    return fetchAllPrices().length;
}

/**
 * @param {number} offset - zero-based result offset
 * @param {number} limit - page size
 * @param {string} [currency] - unused, see getCount
 * @param {string} [channelId] - unused, see getCount
 * @param {boolean} [aggregate] - unused, see getCount
 * @param {string} [sortField] - pass 'sku' to sort results by SKU before slicing
 * @returns {{ results: Array, total: number }} this page's price records and the overall total
 */
function fetchBatch(offset, limit, currency, channelId, aggregate, sortField) {
    var all   = fetchAllPrices();
    var start = offset || 0;
    var lim   = limit || 500;

    if (sortField === 'sku') {
        all.sort(function (a, b) {
            if (a.sku < b.sku) return -1;
            if (a.sku > b.sku) return 1;
            return 0;
        });
    }

    return {
        results: all.slice(start, start + lim),
        total:   all.length
    };
}

/**
 * SAP has no distribution channels exposed via /products/search — single target.
 * @returns {Array} one-entry array representing this base site's price context
 */
function fetchDistributionChannels() {
    return [{
        id:   'sap-default',
        key:  'sap-default',
        name: 'SAP Commerce store (' + getSiteCurrency() + ')'
    }];
}

/**
 * @param {number} count - total priced products found
 * @param {boolean} [embeddedSource] - true to build the "embedded" variant of the target
 * @returns {Array} single discovery target for this base site's one currency
 */
function buildTargetsFromCount(count, embeddedSource) {
    var currency = getSiteCurrency();
    return [{
        exportKey:  (embeddedSource ? 'emb_agg_' : 'agg_') + exportKeySafe(currency),
        label:      currency + ' — SAP Commerce catalog',
        subLabel:   'Prices embedded on SAP Commerce products',
        currency:   currency,
        channelId:  'all',
        channelKey: '',
        aggregate:  true,
        priceCount: count,
        source:     embeddedSource ? 'embedded' : 'standalone'
    }];
}

/**
 * SAP has one currency, so discovery always finishes in a single step — no
 * offset/reset needed the way CTP's paginated discovery requires them.
 * @returns {Object} discovery result with the single standalone target
 */
function discoverStandaloneStep() {
    var prices = fetchAllPrices();
    return {
        done:       true,
        nextOffset: prices.length,
        scanned:    prices.length,
        total:      prices.length,
        standalone: buildTargetsFromCount(prices.length, false)
    };
}

/**
 * @returns {Array} the single standalone pricebook target for this base site
 */
function discoverPricebookTargets() {
    return discoverStandaloneStep(0, true).standalone || [];
}

/**
 * Same data as discoverStandaloneStep — only the exportKey/label differ.
 * @returns {Object} discovery result with the single embedded target
 */
function discoverEmbeddedStep() {
    var prices = fetchAllPrices();
    return {
        done:       true,
        nextOffset: prices.length,
        scanned:    prices.length,
        total:      prices.length,
        embedded:   buildTargetsFromCount(prices.length, true)
    };
}

/**
 * @returns {Array} the single embedded pricebook target for this base site
 */
function discoverEmbeddedPricebookTargets() {
    return discoverEmbeddedStep(0, true).embedded || [];
}

/**
 * @param {string} [currency] - unused, see getCount
 * @param {string} [channelId] - unused, see getCount
 * @param {boolean} [aggregate] - unused, see getCount
 * @returns {number} total number of priced products
 */
function getPriceCount(currency, channelId, aggregate) {
    return getCount(currency, channelId, aggregate);
}

/**
 * Same contract as ctpEmbeddedPriceFetcher.fetchPriceRecordsBatch / shopifyPricebookFetcher.fetchPriceRecordsBatch.
 * @param {number} offset - zero-based result offset
 * @param {number} [limit] - page size, defaults to 500
 * @param {string} [currency] - unused, see getCount
 * @param {string} [channelId] - unused, see getCount
 * @param {boolean} [aggregate] - unused, see getCount
 * @returns {{ records: Array, total: number, nextOffset: number, done: boolean }} transformed price records for this page
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

module.exports = {
    getCount:                         getCount,
    getPriceCount:                     getPriceCount,
    fetchBatch:                        fetchBatch,
    fetchPriceRecordsBatch:            fetchPriceRecordsBatch,
    fetchDistributionChannels:         fetchDistributionChannels,
    discoverPricebookTargets:          discoverPricebookTargets,
    discoverStandaloneStep:            discoverStandaloneStep,
    discoverEmbeddedStep:              discoverEmbeddedStep,
    discoverEmbeddedPricebookTargets:  discoverEmbeddedPricebookTargets
};
