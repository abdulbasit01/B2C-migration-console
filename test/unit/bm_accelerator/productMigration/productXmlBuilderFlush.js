'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path = require('path');

var xmlBuilderPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/productMigration/productXmlBuilder.js'
);

var SFCC_STRING_QUOTA = 1000000;

/**
 * @returns {Object} productXmlBuilder with cartridge dependencies stubbed
 */
function loadXmlBuilder() {
    return proxyquire(xmlBuilderPath, {
        '*/cartridge/scripts/migration/productMigration/productTransformer': {
            transformProduct: function () { return {}; },
            resolveMasterProductId: function (p) { return p && p.id ? String(p.id) : ''; }
        },
        '*/cartridge/scripts/migration/config/nativeFieldMap': {
            getRule: function () { return null; },
            isMapAction: function () { return false; },
            resolveSystemId: function () { return null; }
        },
        '*/cartridge/scripts/migration/core/attrIdMapSession': {
            read: function () { return {}; },
            resolve: function (id) { return id; }
        }
    });
}

/**
 * @param {number} i - product index
 * @returns {Object} transformed product with a large localized description (~30 KB of XML)
 */
function bigProduct(i) {
    var text = new Array(3000).join('lorem ipsum ');
    return {
        productId: 'prod-' + i,
        nameLocales: { en: 'Product ' + i, de: 'Produkt ' + i },
        longDescriptionLocales: { en: text, de: text, fr: text },
        onlineFlag: true,
        categories: [],
        variants: [],
        hasVariants: false,
        productKind: 'base'
    };
}

describe('productXmlBuilder.buildXmlParts flushing (api.jsStringLength quota)', function () {
    var raws = [];
    var i;
    for (i = 0; i < 50; i++) raws.push({ id: 'prod-' + i });

    /**
     * @param {Object} raw - raw product stub
     * @returns {Object} transformed product for that stub
     */
    function transform(raw) {
        return bigProduct(Number(raw.id.split('-')[1]));
    }

    it('produces a single batch string over the SFCC quota without onFlush (reproduces the bug)', function () {
        var parts = loadXmlBuilder().buildXmlParts(raws, 'cat', [], transform, {});
        assert.isAbove(parts.productsXml.length, SFCC_STRING_QUOTA);
        assert.equal(parts.built, 50);
    });

    it('hands XML over in pieces below the quota and returns empty strings', function () {
        var pieces = [];
        var cats = [];
        var parts = loadXmlBuilder().buildXmlParts(raws, 'cat', [], transform, {
            onFlush: function (p, c) { pieces.push(p); cats.push(c); }
        });

        assert.isAbove(pieces.length, 1);
        pieces.forEach(function (p) { assert.isBelow(p.length, SFCC_STRING_QUOTA); });
        assert.equal(parts.productsXml, '');
        assert.equal(parts.categoriesXml, '');
        assert.equal(parts.built, 50);
    });

    it('writes exactly the same XML as the unflushed build', function () {
        var reference = loadXmlBuilder().buildXmlParts(raws, 'cat', [], transform, {});
        var pieces = [];
        var cats = [];
        loadXmlBuilder().buildXmlParts(raws, 'cat', [], transform, {
            onFlush: function (p, c) { pieces.push(p); cats.push(c); }
        });
        assert.equal(pieces.join(''), reference.productsXml);
        assert.equal(cats.join(''), reference.categoriesXml);
    });

    it('does not call onFlush for an empty batch', function () {
        var calls = 0;
        loadXmlBuilder().buildXmlParts([], 'cat', [], transform, { onFlush: function () { calls++; } });
        assert.equal(calls, 0);
    });
});
