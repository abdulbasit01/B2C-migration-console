'use strict';

/* eslint-env mocha */

var assert     = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path       = require('path');

var validatorPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/orders/validators/orderValidator.js'
);

/**
 * Build a valid canonical order for validator tests.
 * @returns {Object} canonical order
 */
function validOrder() {
    return {
        orderNumber: 'ORD-1',
        currency: 'USD',
        customer: { id: 'c1', email: 'a@b.com', firstName: 'A', lastName: 'B' },
        billingAddress: { countryCode: 'US' },
        lineItems: [{
            sku: 'SKU-1', name: 'Item', quantity: 1, grossPrice: 10, netPrice: 10
        }],
        orderTotal: 10,
        shippingTotal: 0
    };
}

describe('orderValidator', function () {
    var validator;

    beforeEach(function () {
        validator = proxyquire(validatorPath, {});
    });

    it('should pass a valid order', function () {
        var result = validator.validateOrder(validOrder());
        assert.isTrue(result.valid);
        assert.equal(result.errors.length, 0);
    });

    it('should fail when order number is missing', function () {
        var order = validOrder();
        order.orderNumber = '';
        var result = validator.validateOrder(order);
        assert.isFalse(result.valid);
        assert.ok(result.errors.indexOf('Missing order number') >= 0);
    });

    it('should fail when customer is missing', function () {
        var order = validOrder();
        order.customer = { id: '', email: '' };
        var result = validator.validateOrder(order);
        assert.isFalse(result.valid);
        assert.ok(result.errors.some(function (e) { return e.indexOf('customer') >= 0; }));
    });

    it('should fail when currency is missing', function () {
        var order = validOrder();
        order.currency = '';
        var result = validator.validateOrder(order);
        assert.isFalse(result.valid);
    });

    it('should fail when line items are empty', function () {
        var order = validOrder();
        order.lineItems = [];
        var result = validator.validateOrder(order);
        assert.isFalse(result.valid);
    });

    it('should produce validation report for multiple orders', function () {
        var good = validOrder();
        var bad  = validOrder();
        bad.orderNumber = '';

        var report = validator.validateOrders([good, bad]);
        assert.equal(report.total, 2);
        assert.equal(report.valid, 1);
        assert.equal(report.failed, 1);
        assert.equal(report.results.length, 2);
    });
});
