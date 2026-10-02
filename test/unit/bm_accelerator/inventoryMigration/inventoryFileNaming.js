'use strict';

/* eslint-env mocha */

var assert     = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru().noPreserveCache();
var path       = require('path');

var namingPath = path.join(__dirname, '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/inventoryMigration/inventoryFileNaming.js');
var DIR  = 'src/migration/inventory';
var NAME = 'inventory-eu-warehouse-channel-20261001-v001.xml';

/**
 * Load the naming module against an IMPEX export folder that already holds some files.
 * @param {string[]} files - file names already in the inventory export folder
 * @returns {Object} { naming, checked } - the module and the IMPEX paths it looked up
 */
function load(files) {
    var checked = [];
    var naming = proxyquire(namingPath, {
        '*/cartridge/scripts/migration/core/migrationFileResolver': {
            getRelativePath: function () { return DIR; },
            getRunDate:      function () { return '20261001'; },
            localFileExists: function (rel) {
                checked.push(rel);
                return files.some(function (f) { return DIR + '/' + f === rel; });
            }
        }
    });
    return { naming: naming, checked: checked };
}

describe('inventoryFileNaming', function () {
    it('keeps -v001 for the first export of the day', function () {
        assert.equal(load([]).naming.resolveFileName('ch_eu-warehouse-channel', 0, 500, NAME), NAME);
    });

    it('gives a re-export the next free version, found in the IMPEX export folder', function () {
        var env = load([NAME, 'inventory-eu-warehouse-channel-20261001-v002.xml']);
        assert.equal(env.naming.resolveFileName('ch_eu-warehouse-channel', 0, 500, NAME),
            'inventory-eu-warehouse-channel-20261001-v003.xml');
        assert.include(env.checked, DIR + '/' + NAME);
    });

    it('still numbers the files of a multi-file export by batch', function () {
        assert.equal(load([]).naming.resolveFileName('ch_eu-warehouse-channel', 500, 500, NAME),
            'inventory-eu-warehouse-channel-20261001-v002.xml');
    });
});
