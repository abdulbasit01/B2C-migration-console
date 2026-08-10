'use strict';

var canonicalOrder      = require('*/cartridge/scripts/migration/orders/canonicalOrder');
var orderShippingStatus = require('*/cartridge/scripts/migration/orders/orderShippingStatus');

function parseMoney(val) {
    var n = parseFloat(String(val || '0'));
    return isNaN(n) ? 0 : n;
}

function mapAddress(addr) {
    if (!addr) return canonicalOrder.emptyAddress();
    return {
        firstName:   addr.first_name || '',
        lastName:    addr.last_name || '',
        company:     addr.company || '',
        address1:    addr.street_1 || addr.address1 || '',
        address2:    addr.street_2 || addr.address2 || '',
        city:        addr.city || '',
        stateCode:   addr.state || addr.province_code || '',
        postalCode:  addr.zip || addr.postal_code || '',
        countryCode: addr.country_iso2 || addr.country_code || addr.country || '',
        phone:       addr.phone || ''
    };
}

function mapCustomer(bcOrder) {
    return {
        id:        bcOrder.customer_id ? String(bcOrder.customer_id) : '',
        email:     bcOrder.billing_address ? (bcOrder.billing_address.email || '') : '',
        firstName: (bcOrder.billing_address && bcOrder.billing_address.first_name) || '',
        lastName:  (bcOrder.billing_address && bcOrder.billing_address.last_name) || ''
    };
}

function mapLineItems(bcOrder) {
    var items    = bcOrder.products || [];
    var currency = bcOrder.currency_code || '';
    var mapped   = [];
    var i;

    for (i = 0; i < items.length; i++) {
        var li    = items[i];
        var unit  = parseMoney(li.price_ex_tax != null ? li.price_ex_tax : li.base_price);
        var qty   = parseInt(String(li.quantity || 1), 10) || 1;
        var net   = parseMoney(li.total_ex_tax != null ? li.total_ex_tax : (unit * qty));
        var taxAmt = parseMoney(li.total_tax);
        var gross = parseMoney(li.total_inc_tax != null ? li.total_inc_tax : (net + taxAmt));

        mapped.push({
            id:         li.id ? String(li.id) : String(i + 1),
            sku:        li.sku || (li.product_id ? String(li.product_id) : ''),
            name:       li.name || '',
            quantity:   qty,
            unitPrice:  unit,
            taxAmount:  taxAmt,
            grossPrice: gross,
            netPrice:   net,
            currency:   currency
        });
    }
    return mapped;
}

function mapTaxes(bcOrder) {
    var taxes = [];
    if (bcOrder.total_tax != null) {
        taxes.push({
            name:   'Tax',
            amount: parseMoney(bcOrder.total_tax),
            rate:   0
        });
    }
    return taxes;
}

function mapDiscounts(bcOrder) {
    var discounts = [];
    var coupon    = parseMoney(bcOrder.coupon_discount);
    var discount  = parseMoney(bcOrder.discount_amount);
    if (coupon) {
        discounts.push({
            id:          'coupon',
            code:        '',
            amount:      coupon,
            description: 'Coupon discount'
        });
    }
    if (discount) {
        discounts.push({
            id:          'discount',
            code:        '',
            amount:      discount,
            description: 'Order discount'
        });
    }
    return discounts;
}

function mapBcStatus(status) {
    var s = String(status || '').toLowerCase();
    if (s.indexOf('cancel') >= 0) return 'CANCELLED';
    if (s.indexOf('complete') >= 0 || s.indexOf('shipped') >= 0 || s === 'completed') return 'COMPLETED';
    return 'OPEN';
}

function mapPaymentStatus(paymentStatus) {
    var s = String(paymentStatus || '').toLowerCase();
    if (s === 'paid' || s === 'captured') return 'PAID';
    return 'NOT_PAID';
}

function mapShipments(bcOrder) {
    var shipAddrs = bcOrder.shipping_addresses || [];
    var shipAddr  = shipAddrs.length ? shipAddrs[0] : null;
    var shipNet   = parseMoney(bcOrder.shipping_cost_ex_tax);
    var shipTax   = parseMoney(bcOrder.shipping_cost_tax);
    var method    = (shipAddr && (shipAddr.shipping_method || shipAddr.shipping_zone_name)) || 'STANDARD_SHIPPING';
    var status    = orderShippingStatus.mapShippingStatus(
        String(bcOrder.status || '').toLowerCase().indexOf('shipped') >= 0 ? 'SHIPPED' : 'NOT_SHIPPED'
    );

    return [{
        shipmentId:      '000001',
        status:          status,
        shippingMethod:  method,
        shippingAddress: mapAddress(shipAddr),
        shippingNet:     shipNet,
        shippingTax:     shipTax,
        shippingGross:   shipNet + shipTax
    }];
}

function mapPayments(bcOrder) {
    var payments = [];
    if (bcOrder.payment_method || bcOrder.payment_status) {
        payments.push({
            method:        bcOrder.payment_method || 'BIGCOMMERCE_PAYMENTS',
            amount:        parseMoney(bcOrder.total_inc_tax),
            transactionId: bcOrder.id ? String(bcOrder.id) : ''
        });
    }
    return payments;
}

/**
 * @param {Object} bcOrder
 * @returns {Object}
 */
function mapOrder(bcOrder) {
    var order    = canonicalOrder.createEmpty();
    var currency = bcOrder.currency_code || '';

    order.orderNumber     = bcOrder.id ? String(bcOrder.id) : '';
    order.currency        = currency;
    order.createdAt       = bcOrder.date_created || '';
    order.customerLocale  = 'en_US';
    order.taxation        = 'net';
    order.customer        = mapCustomer(bcOrder);
    order.billingAddress  = mapAddress(bcOrder.billing_address);
    order.shippingAddress = (bcOrder.shipping_addresses && bcOrder.shipping_addresses[0])
        ? mapAddress(bcOrder.shipping_addresses[0])
        : canonicalOrder.emptyAddress();
    order.lineItems       = mapLineItems(bcOrder);
    order.taxes           = mapTaxes(bcOrder);
    order.discounts       = mapDiscounts(bcOrder);
    order.shipments       = mapShipments(bcOrder);
    order.payments        = mapPayments(bcOrder);
    order.status          = mapBcStatus(bcOrder.status);
    order.paymentStatus   = mapPaymentStatus(bcOrder.payment_status);

    order.merchandiseTotal = parseMoney(bcOrder.subtotal_ex_tax);
    order.shippingTotal    = parseMoney(bcOrder.shipping_cost_ex_tax);
    order.taxTotal         = parseMoney(bcOrder.total_tax);
    order.orderTotal       = parseMoney(bcOrder.total_inc_tax);

    return order;
}

function mapOrders(bcOrders) {
    var mapped = [];
    var i;
    for (i = 0; i < bcOrders.length; i++) {
        mapped.push(mapOrder(bcOrders[i]));
    }
    return mapped;
}

module.exports = {
    mapOrder:   mapOrder,
    mapOrders:  mapOrders,
    mapAddress: mapAddress
};
