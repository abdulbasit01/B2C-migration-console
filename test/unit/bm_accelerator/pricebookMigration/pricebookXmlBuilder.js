'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var path = require('path');

var builderPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/pricebookMigration/pricebookXmlBuilder.js'
);

describe('pricebookXmlBuilder product-id whitespace handling', function () {
    var builder;

    before(function () {
        builder = require(builderPath);
    });

    it('trims leading and trailing whitespace from product-id (pricebook.xsd NonEmptyString)', function () {
        var xml = builder.buildPriceTableXml({ sku: ' aqa-701130-90014', amount: '10.00' });
        assert.include(xml, 'product-id="aqa-701130-90014"');
        assert.notInclude(xml, 'product-id=" ');

        xml = builder.buildPriceTableXml({ productId: '\t701130-J2784 \n', amount: '5.00' });
        assert.include(xml, 'product-id="701130-J2784"');
    });

    it('keeps internal whitespace, which the schema allows', function () {
        var xml = builder.buildPriceTableXml({ sku: 'abc 123', amount: '1.00' });
        assert.include(xml, 'product-id="abc 123"');
    });

    it('throws for a whitespace-only product-id so streaming writers count it as failed', function () {
        assert.throws(function () {
            builder.buildPriceTableXml({ sku: '   ', amount: '1.00' });
        }, /Empty product-id/);
    });

    it('buildXml counts whitespace-only ids as failed and never emits an empty product-id', function () {
        var result = builder.buildXml([
            { sku: ' 701130-J2784 ', amount: '5.00' },
            { sku: '  ', amount: '1.00' },
            { sku: 'ok-1', amount: '2.00' }
        ], 'list-prices', 'USD');

        assert.equal(result.built, 2);
        assert.equal(result.failed, 1);
        assert.include(result.xml, 'product-id="701130-J2784"');
        assert.include(result.xml, 'product-id="ok-1"');
        assert.notInclude(result.xml, 'product-id=""');
        assert.notInclude(result.xml, 'product-id=" ');
    });

    it('normalizeProductId handles null, undefined and numeric ids', function () {
        assert.equal(builder.normalizeProductId(null), '');
        assert.equal(builder.normalizeProductId(undefined), '');
        assert.equal(builder.normalizeProductId(9062), '9062');
        assert.equal(builder.normalizeProductId('  x  '), 'x');
    });
});
