'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var path = require('path');
var proxyquire = require('proxyquire').noCallThru();

var runnerPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/core/attrPreflightRunner.js'
);
var compatPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/core/sfccTypeCompat.js'
);

describe('attrPreflightRunner existing custom targets', function () {
    it('returns a compatible normalized custom match without creating it', function () {
        var runner = proxyquire(runnerPath, {
            '*/cartridge/scripts/migration/core/dataSourceRegistry': {
                getPlatformId: function () { return 'commercetools'; }
            },
            '*/cartridge/scripts/migration/core/sourceAttrIds': {
                getAttrGroup: function () { return { id: 'CTPMigration', name: 'CT Migration' }; },
                remapCamelAttrId: function (id) { return id; }
            },
            '*/cartridge/scripts/migration/core/shopifyMetafieldFields': {},
            '*/cartridge/scripts/migration/connectors/ctp/ctpTypeMap': {
                enrichMissingAttribute: function (entry) {
                    return {
                        id: entry.id,
                        label: entry.label,
                        ctpType: entry.sourceType,
                        sfccType: 'string',
                        sfccTypeOptions: [{ value: 'string' }],
                        sourceLocalizable: true,
                        localizable: true,
                        scope: 'localized'
                    };
                }
            },
            '*/cartridge/scripts/migration/connectors/shopify/shopifyTypeMap': {},
            '*/cartridge/scripts/migration/sfccClient': {
                getSFCCToken: function () { return 'token'; },
                getAttributeDefinitions: function () {
                    return [
                        { id: 'name', system: true, valueType: 'string', localizable: true },
                        { id: 'product_name', system: false, valueType: 'string', localizable: true }
                    ];
                },
                ensureAttributeGroup: function () { return true; }
            },
            '*/cartridge/scripts/migration/core/attrBuilder': {},
            '*/cartridge/scripts/migration/config/nativeFieldMap': {
                isExplicitSkip: function () { return false; },
                getRule: function () { return null; },
                getMappedSourceFields: function () { return []; },
                getCoverage: function () { return null; },
                getSkippedFields: function () { return []; },
                resolveSystemId: function () { return null; },
                getSystemValueType: function () { return ''; }
            },
            '*/cartridge/scripts/migration/core/attrIdMapSession': {
                read: function () { return {}; },
                saveFromAttrs: function () {}
            },
            '*/cartridge/scripts/migration/core/openAiClient': {
                isConfigured: function () { return false; }
            },
            '*/cartridge/scripts/migration/core/sfccTypeCompat': require(compatPath)
        });

        var result = runner.classifyFields({
            sfccObjectType: 'Product',
            taskName: 'Product',
            moduleKey: 'product',
            fields: [{
                name: 'productName',
                sfccId: 'productName',
                sourceKey: 'productName',
                label: 'Product Name',
                sourceType: 'LocalizedString'
            }]
        });

        assert.equal(result.missing.length, 1);
        assert.equal(result.missing[0].suggestedCustomField, 'product_name');
        assert.deepEqual(result.missing[0].mappableCustomFields.map(function (f) { return f.id; }), [
            'product_name'
        ]);
    });
});
