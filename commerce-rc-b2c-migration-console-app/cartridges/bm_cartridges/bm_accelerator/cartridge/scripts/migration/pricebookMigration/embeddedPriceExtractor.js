'use strict';

function hasLocalized(obj) {
    return obj && typeof obj === 'object' && Object.keys(obj).length > 0;
}

function toDecimal(value) {
    if (!value || typeof value.centAmount !== 'number') return '';
    var digits  = typeof value.fractionDigits === 'number' ? value.fractionDigits : 2;
    var divisor = Math.pow(10, digits);
    return (value.centAmount / divisor).toFixed(digits);
}

/**
 * @param {Object} ctpProduct
 * @returns {Object}
 */
function getProductView(ctpProduct) {
    var md     = ctpProduct.masterData || {};
    var cur    = md.current || {};
    var staged = md.staged  || {};
    if (hasLocalized(cur.name) || (cur.masterVariant && cur.masterVariant.sku)) {
        return cur;
    }
    return staged;
}

/**
 * @param {Object} data - CT product current/staged view
 * @returns {Array<{sku: string, prices: Array}>}
 */
function collectVariants(data) {
    var out = [];
    var mv  = data.masterVariant;
    if (mv && mv.sku) {
        out.push({ sku: mv.sku, prices: mv.prices || [] });
    }
    var vars = data.variants || [];
    var i;
    for (i = 0; i < vars.length; i++) {
        if (vars[i].sku) {
            out.push({ sku: vars[i].sku, prices: vars[i].prices || [] });
        }
    }
    return out;
}

/**
 * Pick best embedded price for a currency (prefers base / no-channel price).
 * @param {Array} prices
 * @param {string} currency
 * @returns {Object|null}
 */
function findBestPrice(prices, currency) {
    if (!prices || !prices.length) return null;
    var i;
    for (i = 0; i < prices.length; i++) {
        var p = prices[i];
        if (p.value && p.value.currencyCode === currency && !p.channel && !p.country) {
            return p;
        }
    }
    for (i = 0; i < prices.length; i++) {
        var q = prices[i];
        if (q.value && q.value.currencyCode === currency) {
            return q;
        }
    }
    return null;
}

/**
 * @param {Object} priceEntry
 * @param {string} currency
 * @param {string} channelId
 * @returns {boolean}
 */
function priceMatchesChannel(priceEntry, currency, channelId) {
    if (!priceEntry || !priceEntry.value || priceEntry.value.currencyCode !== currency) {
        return false;
    }
    if (!channelId || channelId === 'all') return true;
    var chId = (priceEntry.channel && priceEntry.channel.id) ? priceEntry.channel.id : null;
    return chId === channelId;
}

/**
 * @param {string} sku
 * @param {Object} priceEntry
 * @returns {Object|null}
 */
function toRecord(sku, priceEntry) {
    if (!sku || !priceEntry || !priceEntry.value) return null;
    var amount = toDecimal(priceEntry.value);
    if (!amount) return null;

    var record = {
        sku:        sku,
        amount:     amount,
        currency:   priceEntry.value.currencyCode,
        hasChannel: !!(priceEntry.channel && priceEntry.channel.id)
    };

    // CT quantity tiers -> SFCC price-table quantity-based <amount> rows.
    if (priceEntry.tiers && priceEntry.tiers.length) {
        var tiers = [];
        var ti;
        for (ti = 0; ti < priceEntry.tiers.length; ti++) {
            var tier       = priceEntry.tiers[ti];
            var tierAmount = tier.value ? toDecimal(tier.value) : '';
            if (tierAmount && tier.minimumQuantity) {
                tiers.push({ quantity: tier.minimumQuantity, amount: tierAmount });
            }
        }
        if (tiers.length) record.tiers = tiers;
    }

    return record;
}

/**
 * Extract price records from one CT product for a migration target.
 * @param {Object} ctpProduct
 * @param {string} currency
 * @param {string} channelId
 * @param {boolean} aggregate
 * @returns {Array}
 */
function extractRecordsFromProduct(ctpProduct, currency, channelId, aggregate) {
    var data     = getProductView(ctpProduct);
    var variants = collectVariants(data);
    var records  = [];
    var vi;
    var pi;

    for (vi = 0; vi < variants.length; vi++) {
        var variant = variants[vi];
        if (aggregate) {
            var best = findBestPrice(variant.prices, currency);
            var rec  = best ? toRecord(variant.sku, best) : null;
            if (rec) records.push(rec);
        } else {
            for (pi = 0; pi < (variant.prices || []).length; pi++) {
                if (priceMatchesChannel(variant.prices[pi], currency, channelId)) {
                    var channelRec = toRecord(variant.sku, variant.prices[pi]);
                    if (channelRec) records.push(channelRec);
                    break;
                }
            }
        }
    }
    return records;
}

/**
 * Scan one product and increment discovery counters.
 * @param {Object} ctpProduct
 * @param {Object} aggByCurrency
 * @param {Object} byCurChannel
 */
function scanProductForDiscovery(ctpProduct, aggByCurrency, byCurChannel) {
    var data     = getProductView(ctpProduct);
    var variants = collectVariants(data);
    var vi;
    var pi;

    for (vi = 0; vi < variants.length; vi++) {
        var prices = variants[vi].prices || [];
        for (pi = 0; pi < prices.length; pi++) {
            var p   = prices[pi];
            var cur = p.value && p.value.currencyCode;
            if (!cur) continue;
            if (!aggByCurrency[cur]) aggByCurrency[cur] = 0;
            aggByCurrency[cur]++;
            var chId = (p.channel && p.channel.id) ? p.channel.id : null;
            if (chId) {
                var mapKey = cur + '::' + chId;
                if (!byCurChannel[mapKey]) byCurChannel[mapKey] = 0;
                byCurChannel[mapKey]++;
            }
        }
    }
}

module.exports = {
    extractRecordsFromProduct: extractRecordsFromProduct,
    scanProductForDiscovery:   scanProductForDiscovery,
    getProductView:            getProductView,
    collectVariants:           collectVariants,
    toDecimal:                 toDecimal
};
