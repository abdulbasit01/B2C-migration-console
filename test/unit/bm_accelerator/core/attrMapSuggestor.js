'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path = require('path');

var suggestorPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/core/attrMapSuggestor.js'
);

function loadSuggestor(openAiStub, claimedFields) {
    return proxyquire(suggestorPath, {
        'dw/system/Logger': {
            getLogger: function () {
                return { error: function () {}, warn: function () {}, info: function () {} };
            }
        },
        '*/cartridge/scripts/migration/core/openAiClient': openAiStub,
        '*/cartridge/scripts/migration/core/dataSourceRegistry': {
            getPlatformId: function () { return 'ct'; }
        },
        '*/cartridge/scripts/migration/config/nativeFieldMap': {
            getSystemIds: function () {
                return ['longDescription', 'shortDescription', 'name', 'brand'];
            },
            getClaimedSystemFields: function () {
                return claimedFields || ['shortDescription', 'name'];
            }
        }
    });
}

describe('attrMapSuggestor.filterTargets', function () {
    var suggestor;

    beforeEach(function () {
        suggestor = loadSuggestor({
            isConfigured: function () { return false; },
            chatCompletions: function () { return { ok: false }; }
        });
    });

    it('keeps only allow-listed targets and canonicalizes case', function () {
        var allowed = {
            longdescription: 'longDescription',
            name: 'name'
        };
        var filtered = suggestor.filterTargets([
            { sfccField: 'LongDescription', confidence: 90, reason: 'semantic' },
            { sfccField: 'inventedField', confidence: 0.9, reason: 'bad' },
            { sfccField: 'name', confidence: 0.5, reason: 'ok' },
            { sfccField: 'name', confidence: 0.4, reason: 'dup' }
        ], allowed);
        assert.lengthOf(filtered, 2);
        assert.equal(filtered[0].sfccField, 'longDescription');
        assert.equal(filtered[0].confidence, 0.9);
        assert.equal(filtered[1].sfccField, 'name');
    });

    it('drops empty and invalid entries', function () {
        var filtered = suggestor.filterTargets([
            null,
            { sfccField: '' },
            { id: 'nope' }
        ], { name: 'name' });
        assert.lengthOf(filtered, 0);
    });
});

describe('attrMapSuggestor.buildAllowedSystemIds', function () {
    it('excludes curated alias targets from nativeFieldMap', function () {
        var suggestor = loadSuggestor({
            isConfigured: function () { return false; },
            chatCompletions: function () { return { ok: false }; }
        }, ['shortDescription', 'name']);
        var allowed = suggestor.buildAllowedSystemIds(
            'Product',
            [
                { id: 'longDescription' },
                { id: 'shortDescription' },
                { id: 'name' },
                { id: 'brand' }
            ],
            'ct',
            []
        );
        assert.include(allowed, 'longDescription');
        assert.include(allowed, 'brand');
        assert.notInclude(allowed, 'shortDescription');
        assert.notInclude(allowed, 'name');
    });

    it('also excludes extra Check Attributes mapped fields', function () {
        var suggestor = loadSuggestor({
            isConfigured: function () { return false; },
            chatCompletions: function () { return { ok: false }; }
        }, ['shortDescription']);
        var allowed = suggestor.buildAllowedSystemIds(
            'Product',
            [
                { id: 'longDescription' },
                { id: 'shortDescription' },
                { id: 'brand' }
            ],
            'ct',
            ['longDescription']
        );
        assert.notInclude(allowed, 'longDescription');
        assert.notInclude(allowed, 'shortDescription');
        assert.include(allowed, 'brand');
    });
});

describe('attrMapSuggestor.suggestSystemMaps', function () {
    it('skips when OpenAI is not configured and leaves missing intact via empty suggested', function () {
        var suggestor = loadSuggestor({
            isConfigured: function () { return false; },
            chatCompletions: function () { throw new Error('should not call'); }
        });
        var result = suggestor.suggestSystemMaps({
            missing: [{ id: 'product_description', label: 'Product Description' }],
            taskName: 'Product'
        });
        assert.equal(result.aiStatus, 'skipped');
        assert.lengthOf(result.suggested, 0);
    });

    it('returns suggestions filtered to allow-list and drops curated-claimed targets', function () {
        var suggestor = loadSuggestor({
            isConfigured: function () { return true; },
            chatCompletions: function () {
                return {
                    ok: true,
                    parsed: {
                        suggestions: [{
                            sourceId: 'product_description',
                            targets: [
                                { sfccField: 'shortDescription', confidence: 0.95, reason: 'already curated' },
                                { sfccField: 'longDescription', confidence: 0.92, reason: 'product body copy' },
                                { sfccField: 'notARealField', confidence: 0.8, reason: 'hallucination' }
                            ]
                        }]
                    },
                    error: null
                };
            }
        }, ['shortDescription', 'name']);
        var result = suggestor.suggestSystemMaps({
            missing: [{ id: 'product_description', label: 'Product Description', sourceType: 'ltext' }],
            taskName: 'Product',
            platformId: 'ct',
            liveSystemAttrs: [
                { id: 'longDescription' },
                { id: 'shortDescription' },
                { id: 'name' }
            ]
        });
        assert.equal(result.aiStatus, 'ok');
        assert.lengthOf(result.suggested, 1);
        assert.equal(result.suggested[0].id, 'product_description');
        assert.lengthOf(result.suggested[0].targets, 1);
        assert.equal(result.suggested[0].targets[0].sfccField, 'longDescription');
    });

    it('sets aiStatus error when OpenAI fails', function () {
        var suggestor = loadSuggestor({
            isConfigured: function () { return true; },
            chatCompletions: function () {
                return { ok: false, error: 'HTTP 401', parsed: null };
            }
        });
        var result = suggestor.suggestSystemMaps({
            missing: [{ id: 'color_code', label: 'Color' }],
            taskName: 'Product',
            liveSystemAttrs: [{ id: 'brand' }]
        });
        assert.equal(result.aiStatus, 'error');
        assert.match(result.aiMessage, /401/);
        assert.lengthOf(result.suggested, 0);
    });
});
