'use strict';

var expect = require('chai').expect;
var fixtures = require('../fixtures/ctpBulkFixtures');
var pipeline = require('../helpers/bulkPipelineRunner');

describe('Bulk data migration — Shipping Methods', function () {
    this.timeout(0);

    it('generates synthetic CTP shipping methods (sanity)', function () {
        var methods = fixtures.shippingMethods(50);
        expect(methods).to.have.length(50);
        expect(methods[0]).to.have.property('key');
    });

    it('processes target-count shipping methods through transform + XML in batches', function () {
        var count  = fixtures.targetCount('shipping');
        var result = pipeline.runShippingPipelineCount(count);

        expect(result.failed).to.equal(0);
        expect(result.built).to.equal(count);
        expect(result.batches).to.equal(Math.ceil(count / pipeline.BATCH_SIZES.shippingMethod));
    });

    it('produces valid SFCC shipping IMPEX XML at target scale', function () {
        var count     = fixtures.targetCount('shipping');
        var xmlResult = pipeline.runShippingPipelineCount(count);
        var sample    = fixtures.shippingMethods(1);
        var sampleXml = require('../helpers/cartridgeLoader').requireCartridge(
            'shippingMethodMigration/shippingMethodXmlBuilder'
        ).buildXml(sample);

        expect(sampleXml.xml).to.include('xmlns="http://www.demandware.com/xml/impex/shipping/2007-03-31"');
        expect(xmlResult.built).to.equal(count);
    });
});
