'use strict';

/* eslint-env mocha */

var assert     = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path       = require('path');

var mapperPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/orders/mappers/bigcommerceOrderMapper.js'
);

function loadOrderModule(file) {
    return require(path.join(
        __dirname,
        '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/orders',
        file
    ));
}

var sampleBcOrder = {
    id: 1001,
    status: 'Completed',
    payment_status: 'paid',
    customer_id: 55,
    currency_code: 'USD',
    date_created: '2024-06-15T10:30:00+00:00',
    subtotal_ex_tax: '50.00',
    shipping_cost_ex_tax: '5.00',
    shipping_cost_tax: '0.00',
    total_tax: '5.00',
    total_inc_tax: '60.00',
    coupon_discount: '0',
    discount_amount: '0',
    payment_method: 'Credit Card',
    billing_address: {
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
        street_1: '123 Main St',
        city: 'Boston',
        state: 'MA',
        zip: '02101',
        country_iso2: 'US',
        phone: '555-0100'
    },
    shipping_addresses: [{
        first_name: 'Jane',
        last_name: 'Doe',
        street_1: '456 Ship Ln',
        city: 'Boston',
        zip: '02102',
        country_iso2: 'US',
        shipping_method: 'Flat Rate'
    }],
    products: [{
        id: 1,
        product_id: 10,
        sku: 'WIDGET-BLUE',
        name: 'Blue Widget',
        quantity: 2,
        price_ex_tax: '25.00',
        total_ex_tax: '50.00',
        total_tax: '5.00',
        total_inc_tax: '55.00'
    }]
};

describe('bigcommerceOrderMapper', function () {
    var mapper;

    beforeEach(function () {
        mapper = proxyquire(mapperPath, {
            '*/cartridge/scripts/migration/orders/canonicalOrder': loadOrderModule('canonicalOrder'),
            '*/cartridge/scripts/migration/orders/orderShippingStatus': loadOrderModule('orderShippingStatus')
        });
    });

    it('maps order header and totals', function () {
        var order = mapper.mapOrder(sampleBcOrder);
        assert.equal(order.orderNumber, '1001');
        assert.equal(order.currency, 'USD');
        assert.equal(order.status, 'COMPLETED');
        assert.equal(order.paymentStatus, 'PAID');
        assert.equal(order.merchandiseTotal, 50);
        assert.equal(order.shippingTotal, 5);
        assert.equal(order.taxTotal, 5);
        assert.equal(order.orderTotal, 60);
    });

    it('maps customer and addresses', function () {
        var order = mapper.mapOrder(sampleBcOrder);
        assert.equal(order.customer.id, '55');
        assert.equal(order.customer.email, 'jane@example.com');
        assert.equal(order.billingAddress.firstName, 'Jane');
        assert.equal(order.billingAddress.postalCode, '02101');
        assert.equal(order.shippingAddress.address1, '456 Ship Ln');
    });

    it('maps line items', function () {
        var order = mapper.mapOrder(sampleBcOrder);
        assert.lengthOf(order.lineItems, 1);
        assert.equal(order.lineItems[0].sku, 'WIDGET-BLUE');
        assert.equal(order.lineItems[0].quantity, 2);
        assert.equal(order.lineItems[0].unitPrice, 25);
    });
});
