'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var path = require('path');

var validator = require(path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/productMigration/variationAttributeValidator.js'
));

describe('variationAttributeValidator', function () {
    it('accepts a non-localizable, non-site-specific String definition', function () {
        var result = validator.validateTargets([
            { name: 'packCount', id: 'packCount' }
        ], [{
            id: 'packCount',
            valueType: 'string',
            localizable: false,
            siteSpecific: false
        }]);

        assert.deepEqual(result.notInSfcc, []);
        assert.deepEqual(result.incompatible, []);
    });

    it('reports missing and incompatible variation definitions separately', function () {
        var result = validator.validateTargets([
            { name: 'missingSize', id: 'missingSize' },
            { name: 'packCount', id: 'packCount' },
            { name: 'weight', id: 'weight' }
        ], [{
            id: 'packCount',
            valueType: 'string',
            localizable: true,
            siteSpecific: false
        }, {
            id: 'weight',
            valueType: 'double',
            localizable: false,
            siteSpecific: true
        }]);

        assert.deepEqual(result.notInSfcc, ['missingSize']);
        assert.lengthOf(result.incompatible, 2);
        assert.include(result.incompatible[0].message, 'localizable');
        assert.include(result.incompatible[1].message, 'site-specific');
        assert.include(result.incompatible[1].message, 'not String or Integer');
    });

    it('does not reject an unknown value type omitted by a sparse OCAPI response', function () {
        var reasons = validator.incompatibilityReasons({
            id: 'size',
            valueType: '',
            localizable: false,
            siteSpecific: null
        });

        assert.deepEqual(reasons, []);
    });

    it('allows a localized non-axis field while still requiring its definition to exist', function () {
        var result = validator.validateTargets([{
            name: 'careInstructions',
            id: 'careInstructions',
            validateCompatibility: false
        }, {
            name: 'missingDescription',
            id: 'missingDescription',
            validateCompatibility: false
        }], [{
            id: 'careInstructions',
            valueType: 'text',
            localizable: true,
            siteSpecific: false
        }]);

        assert.deepEqual(result.notInSfcc, ['missingDescription']);
        assert.deepEqual(result.incompatible, []);
    });
});
