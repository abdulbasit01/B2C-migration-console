'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path = require('path');

var nativeMapPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/config/nativeFieldMap.js'
);

var jsonPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/config/nativeFieldMap.json'
);

describe('nativeFieldMap.getSourcesForSystemField', function () {
    var nativeMap;

    beforeEach(function () {
        nativeMap = proxyquire(nativeMapPath, {
            '*/cartridge/scripts/migration/config/nativeFieldMap.json': require(jsonPath),
            '*/cartridge/scripts/migration/core/nativeFieldDetector': {}
        });
    });

    it('returns id for Product system field ID (ct)', function () {
        assert.deepEqual(nativeMap.getSourcesForSystemField('ct', 'Product', 'ID'), ['id']);
        assert.deepEqual(nativeMap.getSourcesForSystemField('commercetools', 'Product', 'ID'), ['id']);
    });

    it('returns description for shortDescription', function () {
        assert.deepEqual(
            nativeMap.getSourcesForSystemField('ct', 'Product', 'shortDescription'),
            ['description']
        );
    });

    it('returns empty when sfcc field has no curated source', function () {
        assert.deepEqual(nativeMap.getSourcesForSystemField('ct', 'Product', 'longDescription'), []);
    });
});
