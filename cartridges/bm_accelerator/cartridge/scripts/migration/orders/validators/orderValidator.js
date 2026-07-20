'use strict';

/**
 * Validate a canonical order and produce a validation report entry.
 * @param {Object} order - CanonicalOrder
 * @returns {Object} { valid, errors, warnings, orderNumber }
 */
function validateOrder(order) {
    var errors   = [];
    var warnings = [];

    if (!order.orderNumber || !String(order.orderNumber).trim()) {
        errors.push('Missing order number');
    }

    if (!order.customer || (!order.customer.email && !order.customer.id)) {
        errors.push('Missing customer (email or id required)');
    }

    if (!order.currency || !String(order.currency).trim()) {
        errors.push('Missing currency');
    }

    if (!order.lineItems || !order.lineItems.length) {
        errors.push('No line items');
    } else {
        for (var i = 0; i < order.lineItems.length; i++) {
            var li = order.lineItems[i];
            if (!li.sku && !li.name) {
                errors.push('Line item ' + (i + 1) + ' missing SKU and name');
            }
            if (!li.quantity || li.quantity <= 0) {
                errors.push('Line item ' + (i + 1) + ' has invalid quantity');
            }
        }
    }

    var lineTotal = 0;
    if (order.lineItems) {
        for (var j = 0; j < order.lineItems.length; j++) {
            lineTotal += order.lineItems[j].grossPrice || order.lineItems[j].netPrice || 0;
        }
    }

    if (order.orderTotal !== undefined && order.orderTotal !== null && lineTotal > 0) {
        var diff = Math.abs(order.orderTotal - lineTotal - (order.shippingTotal || 0));
        if (diff > 0.05) {
            warnings.push('Order total (' + order.orderTotal + ') differs from line items + shipping (' + (lineTotal + (order.shippingTotal || 0)) + ')');
        }
    }

    if (!order.billingAddress || !order.billingAddress.countryCode) {
        warnings.push('Billing address country missing');
    }

    return {
        orderNumber: order.orderNumber || 'unknown',
        valid:       errors.length === 0,
        errors:      errors,
        warnings:    warnings
    };
}

/**
 * Validate an array of canonical orders.
 * @param {Object[]} orders
 * @returns {Object} validation report
 */
function validateOrders(orders) {
    var results  = [];
    var valid    = 0;
    var failed   = 0;

    for (var i = 0; i < orders.length; i++) {
        var entry = validateOrder(orders[i]);
        results.push(entry);
        if (entry.valid) {
            valid++;
        } else {
            failed++;
        }
    }

    return {
        total:   orders.length,
        valid:   valid,
        failed:  failed,
        results: results
    };
}

module.exports = {
    validateOrder:  validateOrder,
    validateOrders: validateOrders
};
