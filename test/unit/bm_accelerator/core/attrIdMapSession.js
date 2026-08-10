'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var path = require('path');

var sessionPath = path.join(
    __dirname,
    '../../../../cartridges/bm_accelerator/cartridge/scripts/migration/core/attrIdMapSession.js'
);

describe('attrIdMapSession.sourcesForTarget', function () {
    var session;
    var fakeStore;

    beforeEach(function () {
        fakeStore = {};
        global.session = {
            custom: fakeStore
        };
        // Fresh require so module sees global.session
        delete require.cache[require.resolve(sessionPath)];
        session = require(sessionPath);
        session.clear('product');
    });

    afterEach(function () {
        delete global.session;
        delete require.cache[require.resolve(sessionPath)];
    });

    it('returns source ids that map to an SFCC target', function () {
        session.saveFromAttrs('product', [
            { canonicalId: 'product_description', id: 'longDescription' },
            { canonicalId: 'color_code', id: 'customColor' }
        ]);
        var sources = session.sourcesForTarget('product', 'longDescription');
        assert.deepEqual(sources, ['product_description']);
    });

    it('is case-insensitive on the SFCC target', function () {
        session.saveFromAttrs('product', [
            { canonicalId: 'product_description', id: 'longDescription' }
        ]);
        assert.deepEqual(session.sourcesForTarget('product', 'LongDescription'), ['product_description']);
    });
});
