'use strict';

/* eslint-env mocha */

var assert     = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru().noPreserveCache();
var path       = require('path');

var root = path.join(__dirname, '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/inventoryMigration');
var transformer = require(path.join(root, 'inventoryTransformer.js'));
var runtimeAttrMap = {
    apply: function () { return { system: {}, custom: [] }; },
    mergeIfEmpty: function () {},
    formatCustomAttrValue: function (v) { return v; }
};
var xmlBuilder = proxyquire(path.join(root, 'inventoryXmlBuilder.js'), {
    '*/cartridge/scripts/migration/core/runtimeAttrMap': runtimeAttrMap
});

describe('inventory records (trimmed SKU, SFCC product ID)', function () {
    it('uses the SFCC product ID the fetcher found', function () {
        var rec = transformer.transformEntry({ sku: 'SKU-A', sfccProductId: 'p-master-1', quantityOnStock: 5 });
        assert.equal(rec.productId, 'p-master-1');
        assert.isFalse(rec.productNotFound);
        assert.equal(rec.allocation, 5);
    });

    it('keeps the trimmed SKU and flags the record when no SFCC product matched', function () {
        var rec = transformer.transformEntry({ sku: ' 701130-J2784', sfccProductId: '', quantityOnStock: 0 });
        assert.equal(rec.productId, '701130-J2784');
        assert.isTrue(rec.productNotFound);
    });

    it('leaves entries from other platforms as before (their product ID, now trimmed)', function () {
        var rec = transformer.transformEntry({ productId: '123', sku: 'ABC', quantityOnStock: 2 });
        assert.equal(rec.productId, '123');
        assert.isFalse(rec.productNotFound);
        assert.equal(transformer.transformEntry({ sku: ' ABC ' }).productId, 'ABC');
    });

    it('merges entries of the same SFCC product when aggregating', function () {
        var recs = transformer.aggregateBySku([
            { sku: ' 701130-J2784', sfccProductId: 'p-1', quantityOnStock: 3 },
            { sku: '701130-J2784', sfccProductId: 'p-1', quantityOnStock: 4 }
        ]);
        assert.lengthOf(recs, 1);
        assert.equal(recs[0].allocation, 7);
    });

    it('uses the export time as allocation-timestamp, not the source change date', function () {
        var before = Date.now();
        var rec = transformer.transformEntry({ sku: 'A', sfccProductId: 'p-1', quantityOnStock: 1, lastModifiedAt: '2022-06-27T13:04:22.615Z' });
        assert.isAtLeast(Date.parse(rec.allocationTimestamp), before - 1000);
        assert.isAtMost(Date.parse(rec.allocationTimestamp), Date.now() + 1000);
    });

    it('maps maxBackorderQuantity to preorder-backorder-allocation instead of a custom attribute', function () {
        var rec = transformer.transformEntry({
            sku: 'B', sfccProductId: 'p-2', quantityOnStock: 0, availableQuantity: 0, restockableInDays: 7,
            custom: { fields: { maxBackorderQuantity: 9999, note: 'x' } }
        });
        assert.equal(rec.preorderBackorder, 'backorder');
        assert.equal(rec.preorderBackorderAllocation, 9999);
        assert.deepEqual(rec.customAttributes, { note: 'x' });
    });

    it('sets the in-stock date for backorders (restockable in N days) and preorders (expected delivery)', function () {
        var back = transformer.transformEntry({ sku: 'C', sfccProductId: 'p-3', quantityOnStock: 0, availableQuantity: 0, restockableInDays: 7 });
        var days = (Date.parse(back.inStockDateTime) - Date.now()) / 86400000;
        assert.isAbove(days, 6.9);
        assert.isBelow(days, 7.1);
        var pre = transformer.transformEntry({ sku: 'D', sfccProductId: 'p-4', quantityOnStock: 0, availableQuantity: 0, expectedDelivery: '2026-12-01T00:00:00.000Z' });
        assert.equal(pre.preorderBackorder, 'preorder');
        assert.equal(pre.inStockDateTime, '2026-12-01T00:00:00.000Z');
        var none = transformer.transformEntry({ sku: 'E', sfccProductId: 'p-5', quantityOnStock: 3, availableQuantity: 3, restockableInDays: 7 });
        assert.isUndefined(none.inStockDateTime);
    });

    it('writes the backorder elements in inventory.xsd order', function () {
        var xml = xmlBuilder.buildRecordXml({
            productId: 'p-2', allocation: 0, allocationTimestamp: '2026-10-01T00:00:00.000Z', perpetual: false,
            preorderBackorder: 'backorder', preorderBackorderAllocation: 9999, inStockDateTime: '2026-10-08T00:00:00.000Z'
        });
        var order = ['<allocation>', '<allocation-timestamp>', '<perpetual>', '<preorder-backorder-handling>backorder',
            '<preorder-backorder-allocation>9999', '<in-stock-datetime>2026-10-08T00:00:00.000Z'].map(function (t) { return xml.indexOf(t); });
        order.forEach(function (pos, i) {
            assert.isAbove(pos, -1, 'missing element ' + i);
            if (i) assert.isAbove(pos, order[i - 1]);
        });
    });

    it('never writes a product-id with surrounding whitespace (inventory.xsd pattern)', function () {
        var xml = xmlBuilder.buildRecordXml({ productId: ' 701130-J2784 ', allocation: 1 });
        assert.include(xml, '<record product-id="701130-J2784">');
        var built = xmlBuilder.buildXml([{ productId: '   ', allocation: 1 }, { productId: 'ok', allocation: 1 }], 'list');
        assert.equal(built.built, 1);
        assert.equal(built.failed, 1);
    });
});
