'use strict';

/* eslint-env mocha */

var assert     = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru().noPreserveCache();
var path       = require('path');

var root = path.join(__dirname, '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/inventoryMigration');

/**
 * Load the inventory runner with in-memory files and a stubbed fetcher.
 * @param {Object[]} entries - inventory entries as the commercetools fetcher returns them
 * @returns {Object} { runner, files }
 */
function load(entries) {
    var files = {};
    /**
     * @param {Object} dir - parent directory stub
     * @param {string} name - file name
     */
    function File(dir, name) { this.name = name; }
    File.prototype.exists = function () { return true; };
    File.prototype.remove = function () {};
    File.prototype.mkdirs = function () {};
    /**
     * @param {Object} file - File stub
     */
    function FileWriter(file) { this.name = file.name; files[this.name] = ''; }
    FileWriter.prototype.write = function (s) { files[this.name] += s; };
    FileWriter.prototype.close = function () {};
    File.IMPEX = 'IMPEX';
    File.SEPARATOR = '/';

    var runtimeAttrMap = {
        apply: function () { return { system: {}, custom: [] }; },
        mergeIfEmpty: function () {},
        formatCustomAttrValue: function (v) { return v; }
    };
    return {
        files: files,
        runner: proxyquire(path.join(root, 'fullMigrationRunner.js'), {
            'dw/io/File': File,
            'dw/io/FileWriter': FileWriter,
            '*/cartridge/scripts/migration/core/dataSourceRegistry': {
                getPlatformId: function () { return 'commercetools'; },
                getSourceLabel: function () { return 'Commercetools'; },
                getFetcher: function () {
                    return { fetchBatch: function (offset) {
                        return { results: offset === 0 ? entries : [], total: entries.length };
                    } };
                }
            },
            '*/cartridge/scripts/migration/inventoryMigration/inventoryTransformer': require(path.join(root, 'inventoryTransformer.js')),
            '*/cartridge/scripts/migration/inventoryMigration/inventoryXmlBuilder': proxyquire(path.join(root, 'inventoryXmlBuilder.js'), {
                '*/cartridge/scripts/migration/core/runtimeAttrMap': runtimeAttrMap
            }),
            '*/cartridge/scripts/migration/inventoryMigration/webDavUploader': {
                ensureDirectory: function () { return { ok: true }; },
                uploadLocalFile: function () { return { ok: true }; },
                uploadFile: function (name, xml) { files[name] = xml; return { ok: true }; }
            },
            '*/cartridge/scripts/migration/core/migrationFileResolver': {
                getRelativePath: function () { return 'src/migration/inventory'; },
                getRunDate: function () { return '20261001'; }
            },
            '*/cartridge/scripts/migration/inventoryMigration/inventoryFileNaming': {
                resolveFileName: function () { return 'inventory-test.xml'; },
                exportKeySafe: function (k) { return k; }
            }
        })
    };
}

var ENTRIES = [
    { sku: 'SKU-A', sfccProductId: 'p-master-1', quantityOnStock: 5 },
    { sku: ' 701130-J2784', sfccProductId: '', quantityOnStock: 0 },
    { sku: 'ORPHAN', sfccProductId: '', quantityOnStock: 1 }
];

describe('inventory fullMigrationRunner', function () {
    it('writes SFCC product IDs and counts records with no matching product (single file)', function () {
        var env = load(ENTRIES);
        var result = env.runner.runBatch(0, 'list', 'all', 'key', '', false, true);
        assert.isTrue(result.ok);
        assert.equal(result.built, 3);
        assert.equal(result.productsNotFound, 2);
        var xml = env.files['inventory-test.xml'];
        assert.include(xml, '<record product-id="p-master-1">');
        assert.include(xml, '<record product-id="701130-J2784">');
        assert.notInclude(xml, 'product-id=" ');
    });

    it('counts records with no matching product in multi-file batches', function () {
        var env = load(ENTRIES);
        var result = env.runner.runBatch(0, 'list', 'all', 'key', '', false, false);
        assert.isTrue(result.ok);
        assert.equal(result.productsNotFound, 2);
    });
});
