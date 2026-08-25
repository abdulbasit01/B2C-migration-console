'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path = require('path');

var resolverPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/core/systemFieldResolver.js'
);

function loadResolver(sessionMap, curatedMap) {
    return proxyquire(resolverPath, {
        '*/cartridge/scripts/migration/config/nativeFieldMap': {
            getSourcesForSystemField: function (platform, task, sfccField) {
                return (curatedMap && curatedMap[sfccField]) || [];
            }
        },
        '*/cartridge/scripts/migration/core/attrIdMapSession': {
            sourcesForTarget: function (moduleKey, sfccField) {
                var out = [];
                var keys = Object.keys(sessionMap || {});
                var i;
                for (i = 0; i < keys.length; i++) {
                    if (sessionMap[keys[i]] === sfccField) out.push(keys[i]);
                }
                return out;
            }
        }
    });
}

describe('systemFieldResolver', function () {
    it('prefers session map over curated alias', function () {
        var resolver = loadResolver(
            { product_description: 'longDescription' },
            { longDescription: ['legacy_long'] }
        );
        var values = {
            product_description: 'From session',
            legacy_long: 'From curated'
        };
        var result = resolver.resolve({
            platformId: 'ct',
            task: 'Product',
            sfccField: 'longDescription',
            moduleKey: 'product',
            getSourceValue: function (k) { return values[k] || ''; }
        });
        assert.equal(result, 'From session');
    });

    it('uses curated sources when session empty', function () {
        var resolver = loadResolver({}, { ID: ['id'] });
        var result = resolver.resolve({
            platformId: 'ct',
            task: 'Product',
            sfccField: 'ID',
            moduleKey: 'product',
            getSourceValue: function (k) {
                return k === 'id' ? 'uuid-123' : '';
            }
        });
        assert.equal(result, 'uuid-123');
    });
});
