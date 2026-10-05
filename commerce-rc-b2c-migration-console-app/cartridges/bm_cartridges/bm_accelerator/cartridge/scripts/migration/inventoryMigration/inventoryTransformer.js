'use strict';

/**
 * Per nativeFieldMap.json: quantityOnStock -> allocation (total stock, available + reserved).
 * @param {Object} entry - CT inventory entry
 * @returns {number}
 */
function getStockOnHand(entry) {
    if (typeof entry.quantityOnStock === 'number') return Math.max(0, entry.quantityOnStock);
    return 0;
}

/**
 * Per nativeFieldMap.json: availableQuantity -> ATS (stock on hand minus reservations).
 * Falls back to stock-on-hand if availableQuantity isn't present.
 * @param {Object} entry - CT inventory entry
 * @returns {number}
 */
function getAvailableToSell(entry) {
    if (typeof entry.availableQuantity === 'number') return Math.max(0, entry.availableQuantity);
    return getStockOnHand(entry);
}

/**
 * @param {Object} entry - CT inventory entry
 * @returns {string} none | preorder | backorder
 */
function getPreorderHandling(entry) {
    var qty = getAvailableToSell(entry);
    if (qty > 0) return 'none';
    if (entry.expectedDelivery) return 'preorder';
    if (entry.restockableInDays != null && entry.restockableInDays > 0) return 'backorder';
    return 'none';
}

/**
 * inventory.xsd allocation-timestamp: when the allocation was counted. The source quantity is
 * the stock now, so this is the export time; a source change date would also be refused when
 * a later import updates the record (quota maxReallocationTimeInPast: at most 48 hours back).
 * @returns {string}
 */
function getTimestamp() {
    return new Date().toISOString();
}

/**
 * inventory.xsd in-stock-datetime for preorders (expected delivery) and backorders (restockable
 * in N days); SFCC warns about a preorder/backorder without an amount or a date.
 * @param {Object} entry - source inventory entry
 * @param {string} handling - none | preorder | backorder
 * @returns {string} ISO date-time, or '' when there is none
 */
function getInStockDateTime(entry, handling) {
    if (handling === 'preorder' && entry.expectedDelivery) return String(entry.expectedDelivery);
    if (handling === 'backorder' && entry.restockableInDays > 0) {
        return new Date(Date.now() + entry.restockableInDays * 86400000).toISOString();
    }
    return '';
}

function localizedFallback(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return obj.en || obj['en-US'] || obj['en-GB']
        || (Object.keys(obj).length ? obj[Object.keys(obj)[0]] : '');
}

/**
 * Serialize a raw CT custom-field value for the inventory record's custom attributes.
 * @param {*} val
 * @returns {string}
 */
function formatCustomFieldValue(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'boolean' || typeof val === 'number') return String(val);
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) {
        var parts = [];
        var ai;
        for (ai = 0; ai < val.length; ai++) {
            var item = formatCustomFieldValue(val[ai]);
            if (item) parts.push(item);
        }
        return parts.join(',');
    }
    if (typeof val === 'object') {
        if (val.centAmount !== undefined && val.currencyCode) {
            var digits = typeof val.fractionDigits === 'number' ? val.fractionDigits : 2;
            return (val.centAmount / Math.pow(10, digits)).toFixed(digits) + ' ' + val.currencyCode;
        }
        if (val.id && (val.typeId || val.type_id)) {
            return String(val.id);
        }
        var localized = localizedFallback(val);
        if (localized) return localized;
        try {
            return JSON.stringify(val);
        } catch (e) {
            return '';
        }
    }
    return String(val);
}

/**
 * Transform a single CT inventory entry into a canonical record.
 * @param {Object} entry
 * @returns {Object|null}
 */
function transformEntry(entry) {
    if (!entry) return null;
    // inventory.xsd product-id must not start or end with whitespace (the whole file fails
    // validation otherwise). sfccProductId is the SFCC product the commercetools fetcher found
    // for the SKU; '' means none was found and the SKU is kept.
    var productId = String(entry.sfccProductId || entry.productId || entry.sku || '').trim();
    if (!productId) return null;

    var record = {
        sku:                    productId,
        productId:              productId,
        productNotFound:        entry.sfccProductId === '',
        allocation:             getStockOnHand(entry),
        ats:                    getAvailableToSell(entry),
        perpetual:              false,
        preorderBackorder:      getPreorderHandling(entry),
        allocationTimestamp:    getTimestamp(),
        onOrder:                0,
        turnover:               0,
        supplyChannelId:        entry.supplyChannel && entry.supplyChannel.id
            ? entry.supplyChannel.id : null
    };

    var inStock = getInStockDateTime(entry, record.preorderBackorder);
    if (inStock) record.inStockDateTime = inStock;
    // commercetools maxBackorderQuantity has a native element: inventory.xsd preorder-backorder-allocation
    var maxBackorder = entry.custom && entry.custom.fields ? entry.custom.fields.maxBackorderQuantity : null;
    var nativeMaxBackorder = typeof maxBackorder === 'number' && maxBackorder >= 0;
    if (nativeMaxBackorder) record.preorderBackorderAllocation = maxBackorder;

    if (entry.custom && entry.custom.fields) {
        var customAttrs = {};
        var keys = Object.keys(entry.custom.fields);
        var ci;
        for (ci = 0; ci < keys.length; ci++) {
            if (nativeMaxBackorder && keys[ci] === 'maxBackorderQuantity') continue;
            var formatted = formatCustomFieldValue(entry.custom.fields[keys[ci]]);
            if (formatted !== '') customAttrs[keys[ci]] = formatted;
        }
        if (Object.keys(customAttrs).length) record.customAttributes = customAttrs;
    }

    return record;
}

/**
 * Merge duplicate SKUs in a batch (e.g. multiple supply channels) by summing quantity.
 * @param {Array} entries - raw CT inventory entries
 * @returns {Array}
 */
function aggregateBySku(entries) {
    var map = {};
    var out = [];

    for (var i = 0; i < entries.length; i++) {
        var rec = transformEntry(entries[i]);
        if (!rec) continue;

        if (map[rec.sku]) {
            mergeRecords(map[rec.sku], rec);
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
    if (source.preorderBackorderAllocation != null) {
        target.preorderBackorderAllocation = (target.preorderBackorderAllocation || 0) + source.preorderBackorderAllocation;
    }
    if (!target.inStockDateTime && source.inStockDateTime) {
        target.inStockDateTime = source.inStockDateTime;
    }
}

module.exports = {
    transformEntry:         transformEntry,
    aggregateBySku:         aggregateBySku,
    mergeRecords:           mergeRecords,
    getStockOnHand:         getStockOnHand,
    getAvailableToSell:     getAvailableToSell,
    formatCustomFieldValue: formatCustomFieldValue
};
