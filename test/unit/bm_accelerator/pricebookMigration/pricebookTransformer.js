'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var path = require('path');

var transformerPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/pricebookMigration/pricebookTransformer.js'
);

/**
 * @param {number} cents - amount in minor units
 * @returns {Object} CT money value in USD
 */
function usd(cents) {
    return { centAmount: cents, fractionDigits: 2, currencyCode: 'USD' };
}

describe('pricebookTransformer SKU whitespace handling', function () {
    var transformer;

    before(function () {
        transformer = require(transformerPath);
    });

    it('trims the SKU on standalone CT price entries', function () {
        var rec = transformer.transformEntry({ sku: ' abc ', value: usd(1000) });
        assert.equal(rec.sku, 'abc');
        assert.equal(rec.productId, 'abc');
        assert.equal(rec.amount, '10.00');
    });

    it('drops entries whose SKU is whitespace only', function () {
        assert.isNull(transformer.transformEntry({ sku: '   ', value: usd(1000) }));
    });

    it('aggregateBySku treats " abc" and "abc" as the same SKU', function () {
        var out = transformer.aggregateBySku([
            { sku: ' abc', value: usd(1000), channel: { id: 'ch-1' } },
            { sku: 'abc',  value: usd(900) }
        ]);
        assert.lengthOf(out, 1);
        assert.equal(out[0].sku, 'abc');
    });
});
