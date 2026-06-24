'use strict';

/**
 * Sum numeric field across line items.
 * @param {Object[]} items
 * @param {string} field
 * @returns {number}
 */
function sumField(items, field) {
    var total = 0;
    for (var i = 0; i < items.length; i++) {
        total += parseFloat(items[i][field]) || 0;
    }
    return total;
}

/**
 * Build net/tax/gross money block from components.
 * @param {number} net
 * @param {number} tax
 * @param {number} [gross]
 * @returns {Object}
 */
function moneyBlock(net, tax, gross) {
    var netVal = parseFloat(net) || 0;
    var taxVal = parseFloat(tax) || 0;
    var grossVal = gross !== undefined && gross !== null
        ? (parseFloat(gross) || 0)
        : netVal + taxVal;
    return {
        net:   netVal,
        tax:   taxVal,
        gross: grossVal
    };
}

/**
 * Compute tax rate from net and tax amounts.
 * @param {number} net
 * @param {number} tax
 * @returns {number}
 */
function taxRate(net, tax) {
    var netVal = parseFloat(net) || 0;
    var taxVal = parseFloat(tax) || 0;
    if (netVal <= 0) return 0;
    return taxVal / netVal;
}

/**
 * Recalculate reconciled totals and per-shipment aggregates for XML export.
 * @param {Object} order - CanonicalOrder (mutated)
 * @returns {Object} order
 */
function reconcileOrder(order) {
    var lineItems = order.lineItems || [];
    var shipments = order.shipments || [];

    if (!shipments.length) {
        shipments.push({
            id:              '000001',
            shipmentId:      '000001',
            status:          'NOT_SHIPPED',
            shippingMethod:  'STANDARD_SHIPPING',
            shippingAddress: order.shippingAddress || order.billingAddress
        });
        order.shipments = shipments;
    }

    for (var s = 0; s < shipments.length; s++) {
        if (!shipments[s].shipmentId) {
            shipments[s].shipmentId = padShipmentId(s + 1);
        }
        shipments[s].id = shipments[s].shipmentId;
    }

    var defaultShipmentId = shipments[0].shipmentId;

    for (var i = 0; i < lineItems.length; i++) {
        if (!lineItems[i].shipmentId) {
            lineItems[i].shipmentId = defaultShipmentId;
        }
        if (lineItems[i].taxBasis === undefined || lineItems[i].taxBasis === null) {
            lineItems[i].taxBasis = lineItems[i].netPrice || 0;
        }
        if (lineItems[i].taxRate === undefined || lineItems[i].taxRate === null) {
            lineItems[i].taxRate = taxRate(lineItems[i].netPrice, lineItems[i].taxAmount);
        }
    }

    var shippingLineItems = order.shippingLineItems || [];
    if (!shippingLineItems.length) {
        var shipNet  = 0;
        var shipTax  = 0;
        var shipGross = 0;
        if (shipments[0].shippingNet !== undefined) {
            shipNet   = shipments[0].shippingNet;
            shipTax   = shipments[0].shippingTax || 0;
            shipGross = shipments[0].shippingGross !== undefined
                ? shipments[0].shippingGross
                : shipNet + shipTax;
        } else {
            shipGross = parseFloat(order.shippingTotal) || 0;
            shipNet   = shipGross;
            shipTax   = 0;
        }

        shippingLineItems.push({
            netPrice:     shipNet,
            taxAmount:    shipTax,
            grossPrice:   shipGross,
            basePrice:    shipNet,
            taxBasis:     shipNet,
            taxRate:      taxRate(shipNet, shipTax),
            lineitemText: 'Shipping',
            itemId:       shipments[0].shippingMethod || 'STANDARD_SHIPPING',
            shipmentId:   defaultShipmentId
        });
        order.shippingLineItems = shippingLineItems;
    }

    for (var j = 0; j < shippingLineItems.length; j++) {
        if (!shippingLineItems[j].shipmentId) {
            shippingLineItems[j].shipmentId = defaultShipmentId;
        }
        if (!shippingLineItems[j].itemId) {
            shippingLineItems[j].itemId = 'STANDARD_SHIPPING';
        }
        if (!shippingLineItems[j].lineitemText) {
            shippingLineItems[j].lineitemText = 'Shipping';
        }
        if (shippingLineItems[j].taxBasis === undefined) {
            shippingLineItems[j].taxBasis = shippingLineItems[j].netPrice || 0;
        }
        if (shippingLineItems[j].taxRate === undefined) {
            shippingLineItems[j].taxRate = taxRate(
                shippingLineItems[j].netPrice,
                shippingLineItems[j].taxAmount
            );
        }
    }

    var merchandise = moneyBlock(
        sumField(lineItems, 'netPrice'),
        sumField(lineItems, 'taxAmount'),
        sumField(lineItems, 'grossPrice')
    );
    var shipping = moneyBlock(
        sumField(shippingLineItems, 'netPrice'),
        sumField(shippingLineItems, 'taxAmount'),
        sumField(shippingLineItems, 'grossPrice')
    );
    var orderTotal = moneyBlock(
        merchandise.net + shipping.net,
        merchandise.tax + shipping.tax,
        merchandise.gross + shipping.gross
    );

    order.merchandiseTotal = merchandise.net;
    order.shippingTotal    = shipping.gross;
    order.taxTotal         = orderTotal.tax;
    order.orderTotal       = orderTotal.gross;
    order.totals = {
        merchandise: merchandise,
        shipping:    shipping,
        order:       orderTotal
    };

    for (var k = 0; k < shipments.length; k++) {
        var sid = shipments[k].shipmentId;
        var shipmentProducts = [];
        for (var p = 0; p < lineItems.length; p++) {
            if (lineItems[p].shipmentId === sid) {
                shipmentProducts.push(lineItems[p]);
            }
        }
        var shipmentShipping = [];
        for (var h = 0; h < shippingLineItems.length; h++) {
            if (shippingLineItems[h].shipmentId === sid) {
                shipmentShipping.push(shippingLineItems[h]);
            }
        }

        var shipmentMerch = moneyBlock(
            sumField(shipmentProducts, 'netPrice'),
            sumField(shipmentProducts, 'taxAmount'),
            sumField(shipmentProducts, 'grossPrice')
        );
        var shipmentShip = moneyBlock(
            sumField(shipmentShipping, 'netPrice'),
            sumField(shipmentShipping, 'taxAmount'),
            sumField(shipmentShipping, 'grossPrice')
        );
        var shipmentTotal = moneyBlock(
            shipmentMerch.net + shipmentShip.net,
            shipmentMerch.tax + shipmentShip.tax,
            shipmentMerch.gross + shipmentShip.gross
        );

        shipments[k].totals = {
            merchandise: shipmentMerch,
            shipping:    shipmentShip,
            shipment:    shipmentTotal
        };
    }

    return order;
}

/**
 * @param {number} index - 1-based
 * @returns {string}
 */
function padShipmentId(index) {
    var id = String(index);
    while (id.length < 6) id = '0' + id;
    return id;
}

module.exports = {
    reconcileOrder: reconcileOrder,
    padShipmentId:  padShipmentId,
    moneyBlock:     moneyBlock,
    taxRate:        taxRate,
    sumField:       sumField
};
