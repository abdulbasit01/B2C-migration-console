'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path = require('path');

var transformerPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/productMigration/productTransformer.js'
);

/**
 * @returns {Object} productTransformer with the system field resolver stubbed
 */
function loadTransformer() {
    return proxyquire(transformerPath, {
        '*/cartridge/scripts/migration/core/systemFieldResolver': {
            getSourceKeys: function (platform, task, sfccField) {
                return sfccField === 'ID' ? ['id'] : [];
            },
            resolve: function (opts) {
                return opts.sfccField === 'ID' ? opts.getSourceValue('id') : '';
            }
        }
    });
}

/**
 * @param {string} id - product id
 * @returns {Object} CT product reference
 */
function ref(id) {
    return { typeId: 'product', id: id };
}

/**
 * @param {Object} opts - { typeName, attributes, variants }
 * @returns {Object} minimal CT product
 */
function ctProduct(opts) {
    return {
        id: 'aaaaaaaa-0000-0000-0000-000000000001',
        key: 'k1',
        productType: { obj: { name: opts.typeName || 'Personalizable', attributes: [] } },
        masterData: {
            published: true,
            current: {
                name: { en: 'P' },
                masterVariant: { id: 1, sku: 'SKU-1', attributes: opts.attributes || [], prices: [] },
                variants: opts.variants || []
            }
        }
    };
}

var MEMBERS = [ref('11111111-0000-0000-0000-000000000001'), ref('22222222-0000-0000-0000-000000000002')];

describe('productTransformer product set detection', function () {
    var transformer;

    before(function () {
        transformer = loadTransformer();
    });

    it('does not turn recommendation lists into a product set', function () {
        ['recommendedProductsEU', 'recommendedProductsUS', 'accessories', 'relatedProducts', 'upsellProducts', 'crossSellItems']
            .forEach(function (name) {
                var t = transformer.transformProduct(ctProduct({ attributes: [{ name: name, value: MEMBERS }] }));
                assert.equal(t.productKind, 'base', name);
                assert.deepEqual(t.setProducts, [], name);
            });
    });

    it('does not turn a single product reference into a set', function () {
        var t = transformer.transformProduct(ctProduct({
            attributes: [{ name: 'customizableAccessory', value: ref('33333333-0000-0000-0000-000000000003') }]
        }));
        assert.equal(t.productKind, 'base');
    });

    it('keeps a product with real variants as a variation master', function () {
        var t = transformer.transformProduct(ctProduct({
            attributes: [{ name: 'setProducts', value: MEMBERS }],
            variants: [{ id: 2, sku: 'SKU-2', attributes: [], prices: [] }]
        }));
        assert.equal(t.productKind, 'base');
        assert.isTrue(t.hasVariants);
    });

    it('still builds a set from a genuine set-member attribute on a single-variant product', function () {
        var t = transformer.transformProduct(ctProduct({ attributes: [{ name: 'setProducts', value: MEMBERS }] }));
        assert.equal(t.productKind, 'set');
        assert.deepEqual(t.setProducts.map(function (m) { return m.productId; }),
            MEMBERS.map(function (m) { return m.id; }));
    });

    it('takes set members from the set attribute, not from recommendations, when both exist', function () {
        var t = transformer.transformProduct(ctProduct({
            typeName: 'Gift Set',
            attributes: [
                { name: 'recommendedProductsEU', value: [ref('99999999-0000-0000-0000-000000000009')] },
                { name: 'setProducts', value: MEMBERS }
            ]
        }));
        assert.equal(t.productKind, 'set');
        assert.deepEqual(t.setProducts.map(function (m) { return m.productId; }),
            MEMBERS.map(function (m) { return m.id; }));
    });

    it('leaves the product type rule for bundles unchanged', function () {
        var t = transformer.transformProduct(ctProduct({
            typeName: 'Bundle',
            attributes: [{ name: 'recommendedProductsEU', value: MEMBERS }]
        }));
        assert.equal(t.productKind, 'bundle');
    });
});
