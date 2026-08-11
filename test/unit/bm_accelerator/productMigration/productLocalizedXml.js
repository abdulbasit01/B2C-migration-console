'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path = require('path');

var transformerPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/productMigration/productTransformer.js'
);
var xmlBuilderPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/productMigration/productXmlBuilder.js'
);

function loadTransformer(sessionMap) {
    sessionMap = sessionMap || {};
    var curated = {
        ID: ['id'],
        name: ['name'],
        shortDescription: ['description'],
        longDescription: [],
        pageURL: ['slug'],
        pageTitle: ['metaTitle'],
        pageDescription: ['metaDescription'],
        pageKeywords: ['metaKeywords'],
        manufacturerSKU: ['sku'],
        taxClassID: ['taxCategory'],
        brand: [],
        manufacturerName: [],
        EAN: [],
        UPC: [],
        onlineFlag: ['masterData.published'],
        minOrderQuantity: [],
        stepQuantity: [],
        unitQuantity: [],
        unit: [],
        unitMeasure: []
    };
    return proxyquire(transformerPath, {
        '*/cartridge/scripts/migration/core/systemFieldResolver': {
            getSourceKeys: function (platform, task, sfccField) {
                var out = [];
                var keys = Object.keys(sessionMap);
                var i;
                for (i = 0; i < keys.length; i++) {
                    if (sessionMap[keys[i]] === sfccField) out.push(keys[i]);
                }
                return out.concat(curated[sfccField] || []);
            },
            resolve: function (opts) {
                var keys = this.getSourceKeys('ct', 'Product', opts.sfccField);
                var i;
                for (i = 0; i < keys.length; i++) {
                    var v = opts.getSourceValue(keys[i]);
                    if (v) return v;
                }
                return '';
            }
        }
    });
}

function loadXmlBuilder() {
    return proxyquire(xmlBuilderPath, {
        '*/cartridge/scripts/migration/productMigration/productTransformer': {
            transformProduct: function () { return {}; },
            resolveMasterProductId: function (p) { return p && p.id ? String(p.id) : ''; }
        },
        '*/cartridge/scripts/migration/config/nativeFieldMap': {
            getRule: function () { return null; },
            isMapAction: function () { return false; },
            resolveSystemId: function (task, id) {
                var sys = {
                    longDescription: 'longDescription',
                    name: 'name',
                    ID: 'ID'
                };
                return sys[id] || null;
            }
        },
        '*/cartridge/scripts/migration/core/attrIdMapSession': {
            read: function () { return {}; },
            resolve: function (id) { return id; }
        }
    });
}

function sampleTransformed(overrides) {
    overrides = overrides || {};
    var base = {
        productId: '882038c7-1fe6-4b0f-aec3-48fd2da9b106',
        nameLocales: { 'en-US': 'Bulk Seed Product 79' },
        longDescriptionLocales: {
            'en-GB': 'hello this is product description',
            'de-DE': 'Hallo, dies ist die Produktbeschreibung.'
        },
        onlineFlag: true,
        categories: [],
        variants: [],
        hasVariants: false,
        productKind: 'base'
    };
    var k;
    for (k in overrides) {
        if (Object.prototype.hasOwnProperty.call(overrides, k)) base[k] = overrides[k];
    }
    return base;
}

describe('product localized XML', function () {
    it('preserves all CT locales on longDescription from product-description session map', function () {
        var transformer = loadTransformer({ 'product-description': 'longDescription' });
        var t = transformer.transformProduct({
            id: '882038c7-1fe6-4b0f-aec3-48fd2da9b106',
            key: 'bulk-seed-product-0000079',
            masterData: {
                published: true,
                current: {
                    name: { 'en-US': 'Bulk Seed Product 79' },
                    slug: { 'en-US': 'bulk-seed-product-0000079' },
                    masterVariant: {
                        sku: 'SKU-BULK-00000079',
                        attributes: [{
                            name: 'product-description',
                            value: {
                                'en-GB': 'hello this is product description',
                                'de-DE': 'Hallo, dies ist die Produktbeschreibung.'
                            }
                        }]
                    },
                    variants: []
                }
            }
        });
        assert.deepEqual(t.longDescriptionLocales, {
            'en-GB': 'hello this is product description',
            'de-DE': 'Hallo, dies ist die Produktbeschreibung.'
        });
        assert.equal(t.longDescription, 'hello this is product description');
    });

    it('emits long-description for every locale plus x-default', function () {
        var xmlBuilder = loadXmlBuilder();
        var result = xmlBuilder.buildProductXml(sampleTransformed(), []);
        assert.match(result.productXml, /long-description xml:lang="x-default">hello this is product description/);
        assert.match(result.productXml, /long-description xml:lang="en-GB">hello this is product description/);
        assert.match(result.productXml, /long-description xml:lang="de-DE">Hallo, dies ist die Produktbeschreibung\./);
        assert.match(result.productXml, /display-name xml:lang="en-US">Bulk Seed Product 79/);
    });

    it('emits localized custom-attribute entries for CT ltext attrs', function () {
        var xmlBuilder = loadXmlBuilder();
        var masterId = '882038c7-1fe6-4b0f-aec3-48fd2da9b106';
        var result = xmlBuilder.buildProductXml(sampleTransformed({
            productId: masterId,
            hasVariants: true,
            masterAttributes: [{
                name: 'product-spec',
                value: 'Master owned spec'
            }],
            variants: [{
                productId: masterId + '-1',
                sku: 'SKU-BULK-00000079',
                isDefault: true,
                attributes: [{
                    name: 'care-instructions',
                    value: {
                        'en-GB': 'Wash cold',
                        'de-DE': 'Kalt waschen'
                    }
                }]
            }]
        }), ['care-instructions', 'product-spec']);
        assert.match(result.productXml, new RegExp('product product-id="' + masterId + '"'));
        assert.match(result.productXml, new RegExp('product product-id="' + masterId + '-1"'));
        assert.match(result.productXml, /custom-attribute attribute-id="product-spec">Master owned spec/);
        assert.match(result.productXml, /custom-attribute attribute-id="care-instructions" xml:lang="x-default">Wash cold/);
        assert.match(result.productXml, /custom-attribute attribute-id="care-instructions" xml:lang="en-GB">Wash cold/);
        assert.match(result.productXml, /custom-attribute attribute-id="care-instructions" xml:lang="de-DE">Kalt waschen/);
        assert.match(result.productXml, /variant product-id="882038c7-1fe6-4b0f-aec3-48fd2da9b106-1"/);
    });
});
