'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var path = require('path');

var scopePath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/productMigration/productAttributeScope.js'
);
var scope = require(scopePath);

describe('productAttributeScope', function () {
    it('collects current master and variant attributes but ignores staged attributes', function () {
        var names = scope.collectCurrentAttributeNames([{
            masterData: {
                current: {
                    masterVariant: { attributes: [{ name: 'color-code' }] },
                    variants: [{ attributes: [{ name: 'size' }] }]
                },
                staged: {
                    masterVariant: { attributes: [{ name: 'staged-only' }] }
                }
            }
        }]);

        assert.isTrue(names['color-code']);
        assert.isTrue(names.size);
        assert.isUndefined(names['staged-only']);
    });

    it('filters the global Product Type list to attributes present on requested products', function () {
        var fields = [
            { name: 'search-finish' },
            { name: 'productspec' },
            { name: 'size' }
        ];
        var products = [{
            masterData: {
                current: {
                    masterVariant: {
                        attributes: [
                            { name: 'search-finish', value: { key: 'gold' } },
                            { name: 'productspec', value: { en: 'Specification' } }
                        ]
                    },
                    variants: []
                }
            }
        }];

        assert.deepEqual(scope.filterFieldsForProducts(fields, products), [
            { name: 'search-finish' },
            { name: 'productspec' }
        ]);
    });

    it('returns the union of attributes for multiple requested products', function () {
        var fields = [{ name: 'color' }, { name: 'size' }, { name: 'material' }];
        var products = [
            { masterData: { current: { masterVariant: { attributes: [{ name: 'color' }] } } } },
            { masterData: { current: { masterVariant: { attributes: [{ name: 'size' }] } } } }
        ];

        assert.deepEqual(scope.filterFieldsForProducts(fields, products), [
            { name: 'color' },
            { name: 'size' }
        ]);
    });
});
