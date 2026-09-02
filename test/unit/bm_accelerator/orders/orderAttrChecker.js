'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var path = require('path');
var proxyquire = require('proxyquire').noCallThru();

var checkerPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/orders/orderAttrChecker.js'
);

describe('orderAttrChecker', function () {
    it('surfaces Shopify trace fields using explicit Shopify IDs', function () {
        var checker = proxyquire(checkerPath, {
            '*/cartridge/scripts/migration/core/http': {},
            '*/cartridge/scripts/migration/configAccessor': {},
            'dw/crypto/Encoding': {},
            'dw/util/Bytes': function () {},
            '*/cartridge/scripts/migration/core/attrBuilder': {},
            '*/cartridge/scripts/migration/core/attrPreflightRunner': {}
        });
        var fields = checker.getTraceFields('shopify');

        assert.equal(fields.length, 9);
        assert.deepEqual(fields.map(function (field) { return field.sfccId; }), [
            'shopifyOrderId', 'shopifyOrderGid', 'shopifyCheckoutId', 'shopifyClosedAt', 'shopifyCancelledAt',
            'shopifyProcessedAt', 'shopifyTestOrder', 'shopifyTags', 'shopifyNoteAttributes'
        ]);
        assert.deepEqual(checker.getTraceFields('commercetools'), []);
    });
});
