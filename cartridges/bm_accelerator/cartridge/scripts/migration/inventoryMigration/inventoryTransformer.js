'use strict';

/**
 * Prefer sellable quantity; fall back to on-hand stock.
 * @param {Object} entry
 * @returns {number}
 */
function getQuantity(entry) {
    if (typeof entry.availableQuantity === 'number') return Math.max(0, entry.availableQuantity);
    if (typeof entry.quantityOnStock === 'number') return Math.max(0, entry.quantityOnStock);
    return 0;
}

/**
 * @param {Object} entry - CTP inventory entry
 * @returns {string} none | preorder | backorder
 */
function getPreorderHandling(entry) {
    var qty = getQuantity(entry);
    if (qty > 0) return 'none';
    if (entry.expectedDelivery) return 'preorder';
    if (entry.restockableInDays != null && entry.restockableInDays > 0) return 'backorder';
    return 'none';
}

/**
 * @param {Object} entry
 * @returns {string}
 */
function getTimestamp(entry) {
    if (entry.lastModifiedAt) return entry.lastModifiedAt;
    return new Date().toISOString();
}

/**
 * Transform a single CTP inventory entry into a canonical record.
 * @param {Object} entry
 * @returns {Object|null}
 */
function transformEntry(entry) {
    if (!entry) return null;
    var productId = entry.productId || entry.sku;
    if (!productId) return null;
    var qty = getQuantity(entry);
    return {
        sku:                    productId,
        productId:              productId,
        allocation:             qty,
        ats:                    qty,
        perpetual:              false,
        preorderBackorder:      getPreorderHandling(entry),
        allocationTimestamp:    getTimestamp(entry),
        onOrder:                0,
        turnover:               0,
        supplyChannelId:        entry.supplyChannel && entry.supplyChannel.id
            ? entry.supplyChannel.id : null
    };
}

/**
 * Merge duplicate SKUs in a batch (e.g. multiple supply channels) by summing quantity.
 * @param {Array} entries - raw CTP inventory entries
 * @returns {Array}
 */
function aggregateBySku(entries) {
    var map = {};
    var out = [];

    for (var i = 0; i < entries.length; i++) {
        var rec = transformEntry(entries[i]);
        if (!rec) continue;

        if (map[rec.sku]) {
            map[rec.sku].allocation += rec.allocation;
            map[rec.sku].ats        += rec.ats;
            if (rec.allocationTimestamp > map[rec.sku].allocationTimestamp) {
                map[rec.sku].allocationTimestamp = rec.allocationTimestamp;
            }
        } else {
            map[rec.sku] = rec;
            out.push(rec);
        }
    }
    return out;
}

/**
 * @param {Object} target
 * @param {Object} source
 */
function mergeRecords(target, source) {
    target.allocation += source.allocation;
    target.ats        += source.ats;
    if (source.allocationTimestamp > target.allocationTimestamp) {
        target.allocationTimestamp = source.allocationTimestamp;
    }
}

module.exports = {
    transformEntry:   transformEntry,
    aggregateBySku:   aggregateBySku,
    mergeRecords:     mergeRecords,
    getQuantity:      getQuantity
};
