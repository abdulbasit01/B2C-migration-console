'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var utils = require('../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/productMigration/productSplitUtils');

describe('product split utilities', function () {
    it('uses the same 20k per-file limit as customer migration', function () {
        assert.equal(utils.MAX_PER_FILE, 20000);
        assert.equal(utils.MAX_BYTES_PER_FILE, 100 * 1024 * 1024);
        assert.equal(utils.expectedFileCount(500), 1);
        assert.equal(utils.expectedFileCount(20000), 1);
        assert.equal(utils.expectedFileCount(20001), 2);
        assert.equal(utils.expectedFileCount(1000000), 50);
    });

    it('builds ordered product XML part names', function () {
        assert.equal(
            utils.buildPartFileName('ctp-product-20260923-v001.xml', 1),
            'ctp-product-20260923-v001-p0001.xml'
        );
        assert.equal(
            utils.buildPartFileName('ctp-product-20260923-v001.xml', 12),
            'ctp-product-20260923-v001-p0012.xml'
        );
    });

    it('rotates when either the product count or XML size target is reached', function () {
        assert.isTrue(utils.shouldRotate(20000, 1));
        assert.isTrue(utils.shouldRotate(1, 100 * 1024 * 1024));
        assert.isFalse(utils.shouldRotate(19999, (100 * 1024 * 1024) - 1));
    });
});
