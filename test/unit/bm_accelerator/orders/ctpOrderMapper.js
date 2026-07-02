'use strict';

/* eslint-env mocha */

var assert     = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path       = require('path');

var mapperPath = path.join(
    __dirname,
    '../../../../cartridges/bm_accelerator/cartridge/scripts/migration/orders/mappers/ctpOrderMapper.js'
);

function loadOrderModule(file) {
    return require(path.join(
        __dirname,
        '../../../../cartridges/bm_accelerator/cartridge/scripts/migration/orders',
        file
    ));
}

var sampleCtOrder = {
    id: 'abc-123',
    orderNumber: 'ORD-1001',
    createdAt: '2024-06-15T10:30:00.000Z',
    locale: 'en-US',
    orderState: 'Complete',
    paymentState: 'Paid',
    shipmentState: 'Shipped',
    customerEmail: 'jane@example.com',
    customerId: 'cust-1',
    billingAddress: {
        firstName: 'Jane',
        lastName: 'Doe',
        streetName: '123 Main St',
        city: 'Boston',
        state: 'MA',
        postalCode: '02101',
        country: 'US',
        phone: '555-0100'
    },
    shippingAddress: {
        firstName: 'Jane',
        lastName: 'Doe',
        streetName: '456 Ship Ln',
        city: 'Boston',
        postalCode: '02102',
        country: 'US'
    },
    lineItems: [{
        id: 'li-1',
        name: { en: 'Blue Widget' },
        quantity: 2,
        variant: { sku: 'WIDGET-BLUE' },
        price: { value: { centAmount: 2500, fractionDigits: 2, currencyCode: 'USD' } },
        taxedPrice: {
            totalNet:   { centAmount: 5000, fractionDigits: 2 },
            totalGross: { centAmount: 5500, fractionDigits: 2 }
        }
    }],
    taxedPrice: {
        totalNet:   { centAmount: 5000, fractionDigits: 2, currencyCode: 'USD' },
        totalGross: { centAmount: 5500, fractionDigits: 2, currencyCode: 'USD' },
        totalTax:   { centAmount: 500, fractionDigits: 2 },
        taxPortions: [{ name: 'Sales Tax', amount: { centAmount: 500, fractionDigits: 2 }, rate: 0.1 }]
    },
    totalPrice: { centAmount: 5500, fractionDigits: 2, currencyCode: 'USD' },
    shippingInfo: {
        shippingMethodName: 'Standard',
        taxedPrice: { totalGross: { centAmount: 0, fractionDigits: 2 } }
    }
};

describe('ctpOrderMapper', function () {
    var mapper;

    beforeEach(function () {
        mapper = proxyquire(mapperPath, {
            '*/cartridge/scripts/migration/orders/canonicalOrder': loadOrderModule('canonicalOrder'),
            '*/cartridge/scripts/migration/orders/localizedString': loadOrderModule('localizedString'),
            '*/cartridge/scripts/migration/orders/orderShippingStatus': loadOrderModule('orderShippingStatus')
        });
    });

    it('should map commercetools order to canonical order', function () {
        var order = mapper.mapOrder(sampleCtOrder);

        assert.equal(order.orderNumber, 'ORD-1001');
        assert.equal(order.currency, 'USD');
        assert.equal(order.customerLocale, 'en_US');
        assert.equal(order.taxation, 'net');
        assert.equal(order.customer.email, 'jane@example.com');
        assert.equal(order.status, 'COMPLETED');
        assert.equal(order.paymentStatus, 'PAID');
        assert.equal(order.shipments[0].shipmentId, '000001');
        assert.equal(order.shipments[0].status, 'SHIPPED');
        assert.equal(order.lineItems.length, 1);
        assert.equal(order.lineItems[0].sku, 'WIDGET-BLUE');
        assert.equal(order.lineItems[0].name, 'Blue Widget');
        assert.equal(order.lineItems[0].quantity, 2);
        assert.equal(order.lineItems[0].unitPrice, 25);
        assert.equal(order.billingAddress.city, 'Boston');
        assert.equal(order.shippingAddress.city, 'Boston');
        assert.equal(order.taxes.length, 1);
        assert.equal(order.taxes[0].amount, 5);
        assert.equal(order.orderTotal, 55);
    });

    it('should convert money amounts from centAmount', function () {
        assert.equal(mapper.moneyToDecimal({ centAmount: 1999, fractionDigits: 2 }), 19.99);
        assert.equal(mapper.moneyToDecimal(null), 0);
    });

    it('should map multiple orders', function () {
        var orders = mapper.mapOrders([sampleCtOrder, sampleCtOrder]);
        assert.equal(orders.length, 2);
        assert.equal(orders[0].orderNumber, 'ORD-1001');
    });
});
