'use strict';

var ORDER_STATUSES = {
    NOT_SHIPPED:  true,
    PART_SHIPPED: true,
    SHIPPED:      true
};

var SHIPMENT_STATUSES = {
    NOT_SHIPPED: true,
    SHIPPED:     true
};

/**
 * Map source shipment state to order-level shipping-status.
 * @param {string} state
 * @returns {string}
 */
function mapOrderShippingStatus(state) {
    if (!state) return 'NOT_SHIPPED';

    var normalized = String(state).toLowerCase().replace(/[\s_-]+/g, '');

    if (normalized === 'shipped' || normalized === 'delivered') {
        return 'SHIPPED';
    }
    if (normalized === 'partial' || normalized === 'partiallyshipped' || normalized === 'partshipped') {
        return 'PART_SHIPPED';
    }
    if (normalized === 'pending' || normalized === 'ready' || normalized === 'backorder'
        || normalized === 'delayed' || normalized === 'notshipped') {
        return 'NOT_SHIPPED';
    }

    var upper = String(state).toUpperCase();
    if (ORDER_STATUSES[upper]) return upper;

    return 'NOT_SHIPPED';
}

/**
 * Map source shipment state to shipment-level shipping-status.
 * Shipment XSD only allows NOT_SHIPPED or SHIPPED.
 * @param {string} state
 * @returns {string}
 */
function mapShipmentShippingStatus(state) {
    var orderStatus = mapOrderShippingStatus(state);
    if (orderStatus === 'SHIPPED') return 'SHIPPED';
    return 'NOT_SHIPPED';
}

module.exports = {
    mapOrderShippingStatus:     mapOrderShippingStatus,
    mapShipmentShippingStatus:  mapShipmentShippingStatus,
    mapShippingStatus:          mapOrderShippingStatus
};
