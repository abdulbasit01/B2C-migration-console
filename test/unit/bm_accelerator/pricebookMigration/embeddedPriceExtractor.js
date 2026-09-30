'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var path = require('path');

var extractorPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/pricebookMigration/embeddedPriceExtractor.js'
);

/**
 * @param {number} cents - amount in minor units
 * @returns {Object} CT embedded price entry in USD
 */
function usd(cents) {
    return { value: { centAmount: cents, fractionDigits: 2, currencyCode: 'USD' } };
}

/**
 * @param {string} masterSku - SKU of the master variant
 * @param {Array} variants - additional CT variants
 * @returns {Object} minimal CT product projection
 */
function ctProduct(masterSku, variants) {
    return {
        masterData: {
            current: {
                name: { en: 'Test' },
                masterVariant: { sku: masterSku, prices: [usd(1500)] },
                variants: variants
            }
        }
    };
}

describe('embeddedPriceExtractor SKU whitespace handling', function () {
    var extractor;

    before(function () {
        extractor = require(extractorPath);
    });

    it('trims variant SKUs when aggregating embedded prices', function () {
        var records = extractor.extractRecordsFromProduct(
            ctProduct(' aqa-701130-90014', [{ sku: '701130-J2784 ', prices: [usd(2000)] }]),
            'USD', 'all', true
        );
        var skus = records.map(function (r) { return r.sku; });
        assert.deepEqual(skus, ['aqa-701130-90014', '701130-J2784']);
    });

    it('skips variants whose SKU is whitespace only', function () {
        var records = extractor.extractRecordsFromProduct(
            ctProduct('master-1', [{ sku: '   ', prices: [usd(2000)] }, { sku: 'v-2', prices: [usd(3000)] }]),
            'USD', 'all', true
        );
        var skus = records.map(function (r) { return r.sku; });
        assert.deepEqual(skus, ['master-1', 'v-2']);
    });

    it('trims SKUs on the per-channel (non-aggregate) path too', function () {
        var records = extractor.extractRecordsFromProduct(
            ctProduct(' master-1 ', []),
            'USD', 'all', false
        );
        assert.lengthOf(records, 1);
        assert.equal(records[0].sku, 'master-1');
    });
});
