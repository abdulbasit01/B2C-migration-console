'use strict';

var expect = require('chai').expect;
var fixtures = require('../fixtures/ctpBulkFixtures');
var pipeline = require('../helpers/bulkPipelineRunner');

describe('Bulk data migration — Stores', function () {
    this.timeout(0);

    it('generates synthetic CTP stores (sanity)', function () {
        var data = fixtures.stores(25, 10);
        expect(data.stores).to.have.length(25);
        expect(data.channels).to.have.length(10);
    });

    it('transforms stores at target count using channel address enrichment', function () {
        var count  = fixtures.targetCount('stores');
        var result = pipeline.runStorePipelineCount(count);

        expect(result.failed).to.equal(0);
        expect(result.built).to.equal(count);
        expect(result.batches).to.equal(Math.ceil(count / pipeline.BATCH_SIZES.store));
    });

    it('supports selective store export by keys (sample)', function () {
        var data         = fixtures.stores(50, 20);
        var channelById  = fixtures.channelMapFromList(data.channels);
        var selectedKeys = [data.stores[0].key, data.stores[5].key, data.stores[10].key];
        var selected     = data.stores.filter(function (s) {
            return selectedKeys.indexOf(s.key) >= 0;
        });
        var result = pipeline.runStorePipeline(selected, channelById);
        expect(result.built).to.equal(3);
        expect(result.failed).to.equal(0);
    });

    it('produces valid SFCC store IMPEX XML (sanity)', function () {
        var data        = fixtures.stores(5, 5);
        var channelById = fixtures.channelMapFromList(data.channels);
        var records     = require('../helpers/cartridgeLoader').requireCartridge(
            'storeMigration/storeTransformer'
        ).buildStoreRecords(data.stores, channelById);
        var xml = require('../helpers/cartridgeLoader').requireCartridge(
            'storeMigration/storeXmlBuilder'
        ).buildXml(records);
        expect(xml.xml).to.include('<stores');
        expect(xml.built).to.equal(5);
    });
});
