'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var path = require('path');
var proxyquire = require('proxyquire').noCallThru();
var loader = require('../helpers/cartridgeLoader');

var base = path.join(__dirname, '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/core');

/**
 * Load the pre-flight runner, with the real commercetools type map, against fixed SFCC definitions.
 * @param {Array} defs - SFCC definitions { id, system, valueType }
 * @returns {Object} attrPreflightRunner
 */
function loadRunner(defs) {
    return proxyquire(path.join(base, 'attrPreflightRunner.js'), {
        '*/cartridge/scripts/migration/core/dataSourceRegistry': { getPlatformId: function () { return 'commercetools'; } },
        '*/cartridge/scripts/migration/core/sourceAttrIds': {
            getAttrGroup: function () { return { id: 'CTPMigration', name: 'CT Migration' }; },
            remapCamelAttrId: function (id) { return id; }
        },
        '*/cartridge/scripts/migration/core/shopifyMetafieldFields': {},
        '*/cartridge/scripts/migration/connectors/ctp/ctpTypeMap': loader.requireCartridge('connectors/ctp/ctpTypeMap'),
        '*/cartridge/scripts/migration/connectors/shopify/shopifyTypeMap': {},
        '*/cartridge/scripts/migration/sfccClient': {
            getSFCCToken: function () { return 'token'; },
            getAttributeDefinitions: function () { return defs; },
            ensureAttributeGroup: function () { return true; },
            addAttributeToGroup: function () { return true; }
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
        '*/cartridge/scripts/migration/core/attrIdMapSession': { read: function () { return {}; }, saveFromAttrs: function () {} },
        '*/cartridge/scripts/migration/core/openAiClient': { isConfigured: function () { return false; } },
        '*/cartridge/scripts/migration/core/sfccTypeCompat': require(path.join(base, 'sfccTypeCompat.js'))
    });
}

/**
 * A commercetools product-type attribute as productAttrChecker passes it (lowercase type name).
 * @param {string} name - attribute name
 * @param {string} type - commercetools product-type attribute type
 * @returns {Object} field descriptor
 */
function field(name, type) {
    return { name: name, sfccId: name, sourceKey: name, label: name, ctpType: type };
}

describe('attrPreflightRunner existing attribute types', function () {
    it('reports an existing list or boolean attribute of the wrong type instead of "already exists"', function () {
        var runner = loadRunner([
            { id: 'stores', system: false, valueType: 'string' },
            { id: 'isB2B', system: false, valueType: 'string' },
            { id: 'badgeIDs', system: false, valueType: 'set_of_string' },
            { id: 'isB2BProduct', system: false, valueType: 'string' }
        ]);
        var result = runner.classifyFields({
            sfccObjectType: 'Product',
            taskName: 'Product',
            moduleKey: 'product',
            fields: [field('stores', 'set'), field('isB2B', 'boolean'), field('badgeIDs', 'set'), field('isB2BProduct', 'enum')]
        });
        var byId = {};
        result.mapped.forEach(function (m) { byId[m.id] = m; });

        assert.equal(byId.stores.status, 'type-mismatch');
        assert.equal(byId.stores.sfccType, 'string');
        assert.equal(byId.stores.expectedType, 'set_of_string');
        assert.include(byId.stores.note, 'only the first value');
        assert.equal(byId.isB2B.status, 'type-mismatch');
        assert.include(byId.isB2B.note, 'true/false is stored as string');
        assert.equal(byId.badgeIDs.status, 'exists');
        assert.equal(byId.isB2BProduct.status, 'exists');
        assert.lengthOf(result.missing, 0);
    });

    it('never flags SFCC system attributes', function () {
        var runner = loadRunner([{ id: 'stores', system: true, valueType: 'string' }]);
        var result = runner.classifyFields({
            sfccObjectType: 'Product',
            taskName: 'Product',
            moduleKey: 'product',
            fields: [field('stores', 'set')]
        });
        assert.equal(result.mapped[0].status, 'exists');
        assert.equal(result.mapped[0].note, 'Already exists as SFCC system field.');
    });
});
