'use strict';

function toDecimal(value) {
    if (!value || typeof value.centAmount !== 'number') return '';
    var digits  = typeof value.fractionDigits === 'number' ? value.fractionDigits : 2;
    var divisor = Math.pow(10, digits);
    return (value.centAmount / divisor).toFixed(digits);
}

/**
 * @param {Object} entry - CT standalone price
 * @returns {Object|null}
 */
function transformEntry(entry) {
    if (!entry || !entry.value) return null;
    var productId = entry.productId || entry.sku;
    if (!productId) return null;
    var amount = toDecimal(entry.value);
    if (!amount) return null;

    var record = {
        sku:        productId,
        productId:  productId,
        amount:     amount,
        currency:   entry.value.currencyCode,
        hasChannel: !!(entry.channel && entry.channel.id)
    };

    // CT quantity tiers -> SFCC price-table quantity-based <amount> rows (same concept:
    // a different price kicks in once a minimum quantity is reached).
    if (entry.tiers && entry.tiers.length) {
        var tiers = [];
        var ti;
        for (ti = 0; ti < entry.tiers.length; ti++) {
            var tier       = entry.tiers[ti];
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
 * Deduplicate SKU prices when aggregating across channels (prefer base / no-channel price).
 * @param {Array} entries
 * @returns {Array}
 */
function aggregateBySku(entries) {
    var map = {};
    var out = [];
    var i;

    for (i = 0; i < entries.length; i++) {
        var rec = transformEntry(entries[i]);
        if (!rec) continue;

        if (map[rec.sku]) {
            if (!rec.hasChannel && map[rec.sku].hasChannel) {
                map[rec.sku] = rec;
            }
        } else {
            map[rec.sku] = rec;
            out.push(rec);
        }
    }
    return out;
}

/**
 * Merge consecutive SKU rows when streaming aggregate exports (prefer no-channel price).
 * @param {Object} pending
 * @param {Object} rec
 */
function mergeRecords(pending, rec) {
    if (!pending) return rec;
    if (!rec.hasChannel && pending.hasChannel) {
        pending.amount     = rec.amount;
        pending.hasChannel = false;
        pending.tiers      = rec.tiers;
    }
    return pending;
}

module.exports = {
    transformEntry:   transformEntry,
    aggregateBySku:   aggregateBySku,
    mergeRecords:     mergeRecords,
    toDecimal:        toDecimal
};
