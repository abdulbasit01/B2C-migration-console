'use strict';

var expect = require('chai').expect;
var fixtures = require('../fixtures/ctpBulkFixtures');
var pipeline = require('../helpers/bulkPipelineRunner');

describe('Bulk data migration — Pricebooks', function () {
    this.timeout(0);

    describe('standalone prices (/standalone-prices)', function () {
        it('generates bulk standalone price fixtures (sanity)', function () {
            var data = fixtures.standalonePrices(200, 3);
            expect(data.prices).to.have.length(200);
        });

        it('processes standalone prices at target count in batches', function () {
            var count  = fixtures.targetCount('standalonePrices');
            var result = pipeline.runStandalonePricebookPipelineCount(count, {
                pricebookId: 'usd-m-list-prices',
                currency:    'USD',
                aggregate:   true
            });

            expect(result.failed).to.equal(0);
            expect(result.built).to.be.above(0);
            expect(result.built).to.be.at.most(count);
            expect(result.batches).to.equal(Math.ceil(count / pipeline.BATCH_SIZES.pricebook));
        });
    });

    describe('embedded product prices', function () {
        it('generates products with variant embedded prices (sanity)', function () {
            var products = fixtures.productsWithEmbeddedPrices(50, 3);
            expect(products).to.have.length(50);
        });

        it('extracts embedded prices at target product count in batches', function () {
            var count  = fixtures.targetCount('embeddedProducts');
            var result = pipeline.runEmbeddedPricebookPipelineCount(count, {
                currency:    'USD',
                channelId:   'all',
                aggregate:   true,
                pricebookId: 'embedded-bulk-prices'
            });

            expect(result.failed).to.equal(0);
            expect(result.built).to.be.above(0);
            expect(result.batches).to.equal(Math.ceil(count / pipeline.BATCH_SIZES.pricebook));
        });
    });

    it('produces valid SFCC pricebook IMPEX XML (sanity)', function () {
        var xmlBuilder = require('../helpers/cartridgeLoader').requireCartridge(
            'pricebookMigration/pricebookXmlBuilder'
        );
        var xml = xmlBuilder.buildXml([{ sku: 'SKU-TEST-001', amount: '19.99' }], 'test-pb', 'USD', 'bulk');
        expect(xml.xml).to.include('pricebook');
        expect(xml.built).to.equal(1);
    });
});
