'use strict';

var canonicalOrder = require('*/cartridge/scripts/migration/orders/canonicalOrder');
var localizedString = require('*/cartridge/scripts/migration/orders/localizedString').localizedString;

/**
 * Resolve a line item display name from commercetools order data.
 * @param {Object} li
 * @param {Object} variant
 * @returns {string}
 */
function lineItemName(li, variant) {
    var fallback = variant.sku || li.productId || '';
    return localizedString(li.name, '')
        || localizedString(li.productSlug, '')
        || localizedString(variant.title, '')
        || fallback;
}

/**
 * Convert cents (or smallest currency unit) to decimal amount.
 * @param {Object} money - { centAmount, fractionDigits }
 * @returns {number}
 */
function moneyToDecimal(money) {
    if (!money || money.centAmount === undefined || money.centAmount === null) return 0;
    var digits = money.fractionDigits !== undefined ? money.fractionDigits : 2;
    return money.centAmount / Math.pow(10, digits);
}

/**
 * Map a commercetools address to canonical address.
 * @param {Object} addr
 * @returns {Object}
 */
function mapAddress(addr) {
    if (!addr) return canonicalOrder.emptyAddress();
    return {
        firstName:   addr.firstName   || '',
        lastName:    addr.lastName    || '',
        company:     addr.company     || '',
        address1:    addr.streetName  || '',
        address2:    addr.streetNumber ? String(addr.streetNumber) : (addr.additionalStreetInfo || ''),
        city:        addr.city        || '',
        stateCode:   addr.state       || addr.region || '',
        postalCode:  addr.postalCode  || '',
        countryCode: addr.country     || '',
        phone:       addr.phone       || addr.mobile || ''
    };
}

/**
 * Map commercetools customer info from order.
 * @param {Object} ctOrder
 * @returns {Object}
 */
function mapCustomer(ctOrder) {
    var customer = ctOrder.customer || {};
    var email    = ctOrder.customerEmail || customer.email || '';
    return {
        id:        customer.id || ctOrder.customerId || '',
        email:     email,
        firstName: customer.firstName || (ctOrder.billingAddress && ctOrder.billingAddress.firstName) || '',
        lastName:  customer.lastName  || (ctOrder.billingAddress && ctOrder.billingAddress.lastName)  || ''
    };
}

/**
 * Map line items from commercetools order.
 * @param {Object} ctOrder
 * @returns {Object[]}
 */
function mapLineItems(ctOrder) {
    var items    = ctOrder.lineItems || [];
    var currency = ctOrder.totalPrice && ctOrder.totalPrice.currencyCode ? ctOrder.totalPrice.currencyCode : '';
    var mapped   = [];

    for (var i = 0; i < items.length; i++) {
        var li      = items[i];
        var variant = li.variant || {};
        var price   = li.price && li.price.value ? li.price.value : null;
        var taxed   = li.taxedPrice && li.taxedPrice.totalGross ? li.taxedPrice.totalGross : null;
        var net     = li.taxedPrice && li.taxedPrice.totalNet ? li.taxedPrice.totalNet : price;
        var gross   = taxed || price;
        var unit    = price ? moneyToDecimal(price) : 0;
        var netAmt  = net ? moneyToDecimal(net) : unit * (li.quantity || 1);
        var grossAmt = gross ? moneyToDecimal(gross) : netAmt;

        mapped.push({
            id:         li.id || String(i + 1),
            sku:        variant.sku || li.productId || '',
            name:       lineItemName(li, variant),
            quantity:   li.quantity || 1,
            unitPrice:  unit,
            taxAmount:  grossAmt - netAmt,
            grossPrice: grossAmt,
            netPrice:   netAmt,
            currency:   currency
        });
    }
    return mapped;
}

/**
 * Map tax entries from commercetools order.
 * @param {Object} ctOrder
 * @returns {Object[]}
 */
function mapTaxes(ctOrder) {
    var taxes  = [];
    var taxed  = ctOrder.taxedPrice;
    if (taxed && taxed.taxPortions) {
        for (var i = 0; i < taxed.taxPortions.length; i++) {
            var tp = taxed.taxPortions[i];
            taxes.push({
                name:   tp.name || 'Tax',
                amount: moneyToDecimal(tp.amount),
                rate:   tp.rate || 0
            });
        }
    }
    return taxes;
}

/**
 * Map discounts from commercetools order.
 * @param {Object} ctOrder
 * @returns {Object[]}
 */
function mapDiscounts(ctOrder) {
    var discounts = [];
    var codes     = ctOrder.discountCodes || [];
    for (var i = 0; i < codes.length; i++) {
        var dc = codes[i];
        var discount = dc.discountCode && dc.discountCode.obj ? dc.discountCode.obj : {};
        discounts.push({
            id:          discount.id || dc.discountCode && dc.discountCode.id || '',
            code:        discount.code || '',
            amount:      dc.state === 'MatchesCart' ? 0 : 0,
            description: localizedString(discount.name, '')
        });
    }
    if (ctOrder.discountOnTotalPrice && ctOrder.discountOnTotalPrice.discountedAmount) {
        discounts.push({
            id:          'order-discount',
            code:        'ORDER_DISCOUNT',
            amount:      moneyToDecimal(ctOrder.discountOnTotalPrice.discountedAmount),
            description: 'Order discount'
        });
    }
    return discounts;
}

/**
 * Map shipments from commercetools order.
 * @param {Object} ctOrder
 * @returns {Object[]}
 */
function mapShipments(ctOrder) {
    var shipments = [];
    var shipping  = ctOrder.shippingInfo;
    if (shipping) {
        shipments.push({
            id:             shipping.shippingMethodName || 'default',
            status:         ctOrder.shipmentState || '',
            shippingMethod: shipping.shippingMethodName || '',
            shippingAddress: mapAddress(ctOrder.shippingAddress)
        });
    } else if (ctOrder.shippingAddress) {
        shipments.push({
            id:              'default',
            status:          ctOrder.shipmentState || '',
            shippingMethod:  '',
            shippingAddress: mapAddress(ctOrder.shippingAddress)
        });
    }
    return shipments;
}

/**
 * Map commercetools payment state.
 * @param {string} state
 * @returns {string}
 */
function mapPaymentStatus(state) {
    var map = {
        Paid:              'PAID',
        BalanceDue:        'NOT_PAID',
        CreditOwed:        'PAID',
        Failed:            'NOT_PAID',
        Pending:           'NOT_PAID'
    };
    return map[state] || (state || '').toUpperCase();
}

/**
 * Map commercetools order state.
 * @param {string} state
 * @returns {string}
 */
function mapOrderStatus(state) {
    var map = {
        Open:      'NEW',
        Confirmed: 'OPEN',
        Complete:  'COMPLETED',
        Cancelled: 'CANCELLED'
    };
    return map[state] || (state || '').toUpperCase();
}

/**
 * Convert a commercetools order into a CanonicalOrder.
 * @param {Object} ctOrder - raw commercetools order
 * @returns {Object} CanonicalOrder
 */
function mapOrder(ctOrder) {
    var order = canonicalOrder.createEmpty();
    var currency = ctOrder.totalPrice && ctOrder.totalPrice.currencyCode
        ? ctOrder.totalPrice.currencyCode
        : (ctOrder.taxedPrice && ctOrder.taxedPrice.totalGross && ctOrder.taxedPrice.totalGross.currencyCode) || '';

    order.orderNumber     = ctOrder.orderNumber || ctOrder.id || '';
    order.currency        = currency;
    order.createdAt       = ctOrder.createdAt || '';
    order.customer        = mapCustomer(ctOrder);
    order.billingAddress  = mapAddress(ctOrder.billingAddress);
    order.shippingAddress = mapAddress(ctOrder.shippingAddress);
    order.lineItems       = mapLineItems(ctOrder);
    order.taxes           = mapTaxes(ctOrder);
    order.discounts       = mapDiscounts(ctOrder);
    order.shipments       = mapShipments(ctOrder);
    order.status          = mapOrderStatus(ctOrder.orderState);
    order.paymentStatus   = mapPaymentStatus(ctOrder.paymentState);

    var merch = ctOrder.taxedPrice && ctOrder.taxedPrice.totalNet
        ? moneyToDecimal(ctOrder.taxedPrice.totalNet)
        : (ctOrder.totalPrice ? moneyToDecimal(ctOrder.totalPrice) : 0);
    var ship  = ctOrder.shippingInfo && ctOrder.shippingInfo.taxedPrice && ctOrder.shippingInfo.taxedPrice.totalGross
        ? moneyToDecimal(ctOrder.shippingInfo.taxedPrice.totalGross)
        : 0;
    var tax   = ctOrder.taxedPrice && ctOrder.taxedPrice.totalTax
        ? moneyToDecimal(ctOrder.taxedPrice.totalTax)
        : 0;
    var total = ctOrder.taxedPrice && ctOrder.taxedPrice.totalGross
        ? moneyToDecimal(ctOrder.taxedPrice.totalGross)
        : (ctOrder.totalPrice ? moneyToDecimal(ctOrder.totalPrice) : merch + ship);

    order.merchandiseTotal = merch;
    order.shippingTotal    = ship;
    order.taxTotal         = tax;
    order.orderTotal       = total;

    return order;
}

/**
 * Map an array of commercetools orders.
 * @param {Object[]} ctOrders
 * @returns {Object[]}
 */
function mapOrders(ctOrders) {
    var mapped = [];
    for (var i = 0; i < ctOrders.length; i++) {
        mapped.push(mapOrder(ctOrders[i]));
    }
    return mapped;
}

module.exports = {
    mapOrder:      mapOrder,
    mapOrders:     mapOrders,
    mapAddress:    mapAddress,
    mapCustomer:   mapCustomer,
    mapLineItems:  mapLineItems,
    lineItemName:  lineItemName,
    moneyToDecimal: moneyToDecimal
};
