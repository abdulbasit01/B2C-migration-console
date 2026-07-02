'use strict';

/**
 * End-to-end bulk smoke test for all phase-1 modules at the active scale.
 * normal: thousands | stress: 100k–500k | million: up to 1M records
 */
var expect = require('chai').expect;
var fixtures = require('../fixtures/ctpBulkFixtures');
var pipeline = require('../helpers/bulkPipelineRunner');

describe('Bulk data migration — phase 1 smoke (all modules)', function () {
    this.timeout(0);

    it('runs shipping, inventory, pricebook, tax, and store pipelines at scale: ' + fixtures.getScaleName(), function () {
        var scale = fixtures.getScale();

        var shipping = pipeline.runShippingPipelineCount(scale.shipping);
        expect(shipping.failed).to.equal(0);
        expect(shipping.built).to.equal(scale.shipping);

        var inventory = pipeline.runInventoryPipelineCount(scale.inventory, { aggregate: true });
        expect(inventory.failed).to.equal(0);
        expect(inventory.built).to.be.above(0);

        var pricebook = pipeline.runStandalonePricebookPipelineCount(scale.standalonePrices);
        expect(pricebook.failed).to.equal(0);
        expect(pricebook.built).to.be.above(0);

        var embedded = pipeline.runEmbeddedPricebookPipelineCount(scale.embeddedProducts);
        expect(embedded.failed).to.equal(0);
        expect(embedded.built).to.be.above(0);

        var tax = pipeline.runTaxPipelineCount(scale.taxCategories, { type: 'full', id: '' });
        expect(tax.failed).to.equal(0);
        expect(tax.taxRates).to.equal(scale.taxCategories * scale.taxRatesPerCategory);

        var stores = pipeline.runStorePipelineCount(scale.stores);
        expect(stores.failed).to.equal(0);
        expect(stores.built).to.equal(scale.stores);
    });
});
