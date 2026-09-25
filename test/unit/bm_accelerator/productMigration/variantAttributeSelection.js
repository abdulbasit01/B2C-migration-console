'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var selection = require('../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/productMigration/variantAttributeSelection');

describe('variant attribute request selection', function () {
    it('keeps a large selection in the request without using a session string', function () {
        var attrs = [];
        for (var i = 0; i < 200; i++) attrs.push('productAttribute' + i);
        var raw = JSON.stringify(attrs);

        assert.isAbove(raw.length, 2000);
        assert.deepEqual(selection.parse(raw), attrs);
    });

    it('distinguishes a missing selection from an explicit empty selection', function () {
        assert.isNull(selection.parse(null));
        assert.deepEqual(selection.parse('[]'), []);
    });

    it('normalizes duplicate and invalid values', function () {
        assert.deepEqual(selection.parse('[" color ","color",null,12,"size"]'), ['color', 'size']);
    });

    it('rejects non-array JSON', function () {
        assert.throws(function () { selection.parse('{"color":true}'); }, 'attrs must be a JSON array');
    });
});
