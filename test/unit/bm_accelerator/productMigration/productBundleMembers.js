'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path = require('path');

var dir = '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/productMigration/';
var transformerPath = path.join(__dirname, dir + 'productTransformer.js');
var builderPath = path.join(__dirname, dir + 'productXmlBuilder.js');

/**
 * @returns {Object} productTransformer with the system field resolver stubbed (ID from CT id)
 */
function loadTransformer() {
    return proxyquire(transformerPath, {
        '*/cartridge/scripts/migration/core/systemFieldResolver': {
            getSourceKeys: function (platform, task, sfccField) { return sfccField === 'ID' ? ['id'] : []; },
            resolve: function (opts) { return opts.sfccField === 'ID' ? opts.getSourceValue('id') : ''; }
        }
    });
}

/**
 * @param {Object} transformer - loaded productTransformer
 * @returns {Object} productXmlBuilder wired to that transformer
 */
function loadBuilder(transformer) {
    return proxyquire(builderPath, {
        '*/cartridge/scripts/migration/productMigration/productTransformer': transformer,
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
 * @param {string} id - product id (UUID-like)
 * @returns {Object} CT product reference
 */
function ref(id) {
    return { typeId: 'product', id: id };
}

/**
 * @param {string} id - CT product id
 * @param {Object} opts - { typeName, attributes, skus }
 * @returns {Object} minimal CT product
 */
function ctProduct(id, opts) {
    var skus = opts.skus || [id + '-sku'];
    return {
        id: id,
        key: id,
        productType: { obj: { name: opts.typeName || 'Personalizable', attributes: [] } },
        masterData: {
            published: true,
            current: {
                name: { en: id },
                masterVariant: { id: 1, sku: skus[0], attributes: opts.attributes || [], prices: [] },
                variants: skus.slice(1).map(function (s, i) { return { id: i + 2, sku: s, attributes: [], prices: [] }; })
            }
        }
    };
}

var MUG = 'aaaaaaaa-0000-0000-0000-00000000000a';
var CANDY = 'bbbbbbbb-0000-0000-0000-00000000000b';
var INNER = 'cccccccc-0000-0000-0000-00000000000c';
var OTHER = 'dddddddd-0000-0000-0000-00000000000d';

/**
 * @param {string} memberId - CT id of the member
 * @param {string} sku - member SKU
 * @param {number} qty - quantity
 * @returns {Array} one nested bundle line in the project's field names
 */
function line(memberId, sku, qty) {
    return [
        { name: 'bundleProductQuantity', value: qty },
        { name: 'bundleProductReference', value: ref(memberId) },
        { name: 'bundleProductSku', value: sku }
    ];
}

describe('bundle members', function () {
    var transformer;
    var builder;

    before(function () {
        transformer = loadTransformer();
        builder = loadBuilder(transformer);
    });

    it('reads members, quantities and SKUs from bundleProductReferences', function () {
        var t = transformer.transformProduct(ctProduct('bundle-1', {
            typeName: 'Bundle',
            attributes: [{ name: 'bundleProductReferences', value: [line(MUG, 'MUG-XL', 1), line(CANDY, 'CANDY-1', 30)] }]
        }));
        assert.equal(t.productKind, 'bundle');
        assert.deepEqual(t.bundleProducts, [
            { productId: MUG, quantity: 1, sku: 'MUG-XL' },
            { productId: CANDY, quantity: 30, sku: 'CANDY-1' }
        ]);
    });

    it('still reads the reference field names bundled-product / quantity', function () {
        var t = transformer.transformProduct(ctProduct('bundle-2', {
            typeName: 'Bundle',
            attributes: [{ name: 'bundleItems', value: [[{ name: 'bundled-product', value: ref(MUG) }, { name: 'quantity', value: 2 }]] }]
        }));
        assert.deepEqual(t.bundleProducts, [{ productId: MUG, quantity: 2 }]);
    });

    it('never uses recommendation lists as bundle contents', function () {
        var t = transformer.transformProduct(ctProduct('bundle-3', {
            typeName: 'Bundle',
            attributes: [{ name: 'recommendedProductsEU', value: [ref(MUG), ref(CANDY)] }]
        }));
        assert.equal(t.productKind, 'bundle');
        assert.deepEqual(t.bundleProducts, []);
    });

    it('lists bundle member IDs only for bundles', function () {
        var bundle = ctProduct('bundle-4', { typeName: 'Bundle',
            attributes: [{ name: 'bundleProductReferences', value: [line(MUG, 'MUG-XL', 1)] }] });
        assert.deepEqual(transformer.bundleMemberIds(bundle), [MUG]);
        assert.deepEqual(transformer.bundleMemberIds(ctProduct('plain', {})), []);
    });

    it('points each member at the exact variant its SKU names, with its quantity', function () {
        var bundle = ctProduct('bundle-5', { typeName: 'Bundle',
            attributes: [{ name: 'bundleProductReferences', value: [line(MUG, 'MUG-XL', 1), line(CANDY, 'CANDY-2', 40)] }] });
        var mug = ctProduct(MUG, { skus: ['MUG-S', 'MUG-M', 'MUG-XL'] });
        var candy = ctProduct(CANDY, { skus: ['CANDY-1', 'CANDY-2'] });

        // mug in the same batch, candy supplied as a fetched out-of-batch member
        var parts = builder.buildXmlParts([bundle, mug], 'cat', [], null, { bundleMemberProducts: [candy] });
        assert.include(parts.productsXml, '<bundled-product product-id="' + MUG + '-3">\n                <quantity>1</quantity>');
        assert.include(parts.productsXml, '<bundled-product product-id="' + CANDY + '-2">\n                <quantity>40</quantity>');
    });

    it('falls back to the master when the SKU is unknown or the member was not fetched', function () {
        var bundle = ctProduct('bundle-6', { typeName: 'Bundle',
            attributes: [{ name: 'bundleProductReferences', value: [line(MUG, 'NOT-A-MUG-SKU', 1), line(OTHER, 'X', 2)] }] });
        var mug = ctProduct(MUG, { skus: ['MUG-S', 'MUG-M'] });
        var parts = builder.buildXmlParts([bundle, mug], 'cat', [], null, {});
        assert.include(parts.productsXml, '<bundled-product product-id="' + MUG + '">');
        assert.include(parts.productsXml, '<bundled-product product-id="' + OTHER + '">');
    });

    it('keeps a bundle member that is itself a bundle on its own ID', function () {
        var outer = ctProduct('bundle-7', { typeName: 'Bundle',
            attributes: [{ name: 'bundleProductReferences', value: [line(INNER, INNER + '-sku', 1)] }] });
        var inner = ctProduct(INNER, { typeName: 'Bundle',
            attributes: [{ name: 'bundleProductReferences', value: [line(MUG, 'MUG-S', 1)] }] });
        var parts = builder.buildXmlParts([outer, inner], 'cat', [], null, {});
        assert.include(parts.productsXml, '<bundled-product product-id="' + INNER + '">');
        assert.notInclude(parts.productsXml, '<bundled-product product-id="' + INNER + '-1">');
    });
    it('writes the master variant SKU on a bundle, which exports no variant products', function () {
        var bundle = ctProduct('bundle-8', { typeName: 'Bundle', skus: ['BUNDLE-SKU-8'],
            attributes: [{ name: 'bundleProductReferences', value: [line(MUG, 'MUG-S', 1)] }] });
        var xml = builder.buildProductXml(transformer.transformProduct(bundle), []).productXml;
        assert.include(xml, '<manufacturer-sku>BUNDLE-SKU-8</manufacturer-sku>');
    });

    it('keeps SKUs on variants only for a variation master, trimmed', function () {
        var master = ctProduct(MUG, { skus: ['MUG-S', ' MUG-XL '] });
        var xml = builder.buildProductXml(transformer.transformProduct(master), []).productXml;
        var masterPart = xml.substring(0, xml.indexOf('<product product-id="' + MUG + '-1">'));
        assert.notInclude(masterPart, '<manufacturer-sku>');
        assert.include(xml, '<manufacturer-sku>MUG-S</manufacturer-sku>');
        assert.include(xml, '<manufacturer-sku>MUG-XL</manufacturer-sku>');
        assert.notInclude(xml, '<manufacturer-sku> ');
    });
});
