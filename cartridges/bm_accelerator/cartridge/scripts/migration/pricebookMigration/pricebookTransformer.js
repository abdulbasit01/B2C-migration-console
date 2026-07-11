'use strict';

function toDecimal(value) {
    if (!value || typeof value.centAmount !== 'number') return '';
    var digits  = typeof value.fractionDigits === 'number' ? value.fractionDigits : 2;
    var divisor = Math.pow(10, digits);
    return (value.centAmount / divisor).toFixed(digits);
}

/**
 * @param {Object} entry - CTP standalone price
 * @returns {Object|null}
 */
function transformEntry(entry) {
    if (!entry || !entry.sku || !entry.value) return null;
    var amount = toDecimal(entry.value);
    if (!amount) return null;
    return {
        sku:        entry.sku,
        amount:     amount,
        currency:   entry.value.currencyCode,
        hasChannel: !!(entry.channel && entry.channel.id)
    };
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
    }
    return pending;
}

module.exports = {
    transformEntry:   transformEntry,
    aggregateBySku:   aggregateBySku,
    mergeRecords:     mergeRecords,
    toDecimal:        toDecimal
};
