'use strict';

var expect = require('chai').expect;
var fixtures = require('../fixtures/ctpBulkFixtures');
var pipeline = require('../helpers/bulkPipelineRunner');

describe('Bulk data migration — Taxation', function () {
    this.timeout(0);

    it('generates synthetic CT tax categories (sanity)', function () {
        var cats = fixtures.taxCategories(20, 15);
        expect(cats).to.have.length(20);
        expect(cats[0].rates).to.have.length(15);
    });

    it('builds full tax model and XML at target category count', function () {
        var catCount = fixtures.targetCount('taxCategories');
        var rates    = fixtures.targetCount('taxRatesPerCategory');
        var result   = pipeline.runTaxPipelineCount(catCount, { type: 'full', id: '' });

        expect(result.failed).to.equal(0);
        expect(result.taxClasses).to.be.above(0);
        expect(result.taxRates).to.equal(catCount * rates);
        expect(result.built).to.be.above(0);
    });

    it('filters tax export by country scope (sample)', function () {
        var cats   = fixtures.taxCategories(10, 8);
        var result = pipeline.runTaxPipeline(cats, { type: 'country', id: 'US' });
        expect(result.failed).to.equal(0);
        expect(result.taxRates).to.be.above(0);
    });

    it('produces valid SFCC tax IMPEX XML (sanity)', function () {
        var xmlBuilder  = require('../helpers/cartridgeLoader').requireCartridge('taxMigration/taxXmlBuilder');
        var transformer = require('../helpers/cartridgeLoader').requireCartridge('taxMigration/taxTransformer');
        var model = transformer.buildTaxModel(fixtures.taxCategories(3, 4), { type: 'full', id: '' });
        var xml   = xmlBuilder.buildXml(model);
        expect(xml.xml).to.include('tax-classes');
        expect(xml.built).to.be.above(0);
    });
});
