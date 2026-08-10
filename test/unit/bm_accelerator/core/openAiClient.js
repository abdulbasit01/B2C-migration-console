'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path = require('path');

var clientPath = path.join(
    __dirname,
    '../../../../cartridges/bm_accelerator/cartridge/scripts/migration/core/openAiClient.js'
);

describe('openAiClient.parseJsonContent', function () {
    var client;

    beforeEach(function () {
        client = proxyquire(clientPath, {
            'dw/system/Logger': {
                getLogger: function () {
                    return { error: function () {}, warn: function () {}, info: function () {} };
                }
            },
            '*/cartridge/scripts/migration/core/serviceHttp': {
                post: function () { return { status: 200, data: {}, text: '' }; }
            },
            '*/cartridge/scripts/migration/migrationPreferences': {
                getOpenAiConfig: function () {
                    return { enabled: false, apiKey: '', model: 'gpt-4o-mini' };
                }
            }
        });
    });

    it('parses plain JSON objects', function () {
        var parsed = client.parseJsonContent('{"suggestions":[]}');
        assert.isObject(parsed);
        assert.isArray(parsed.suggestions);
    });

    it('strips markdown fences', function () {
        var parsed = client.parseJsonContent('```json\n{"a":1}\n```');
        assert.equal(parsed.a, 1);
    });

    it('extracts embedded JSON object', function () {
        var parsed = client.parseJsonContent('Here you go:\n{"ok":true}\nThanks');
        assert.isTrue(parsed.ok);
    });

    it('returns null for garbage', function () {
        assert.isNull(client.parseJsonContent('not json'));
    });

    it('isConfigured is false when disabled', function () {
        assert.isFalse(client.isConfigured());
    });
});

describe('openAiClient.chatCompletions', function () {
    it('skips when disabled', function () {
        var client = proxyquire(clientPath, {
            'dw/system/Logger': {
                getLogger: function () {
                    return { error: function () {}, warn: function () {}, info: function () {} };
                }
            },
            '*/cartridge/scripts/migration/core/serviceHttp': {
                post: function () { throw new Error('should not call'); }
            },
            '*/cartridge/scripts/migration/migrationPreferences': {
                getOpenAiConfig: function () {
                    return { enabled: false, apiKey: 'sk-test', model: 'gpt-4o-mini' };
                }
            }
        });
        var res = client.chatCompletions([{ role: 'user', content: 'hi' }]);
        assert.isFalse(res.ok);
        assert.match(res.error, /disabled/i);
    });

    it('parses successful chat response', function () {
        var client = proxyquire(clientPath, {
            'dw/system/Logger': {
                getLogger: function () {
                    return { error: function () {}, warn: function () {}, info: function () {} };
                }
            },
            '*/cartridge/scripts/migration/core/serviceHttp': {
                post: function () {
                    return {
                        status: 200,
                        data: {
                            choices: [{
                                message: {
                                    content: JSON.stringify({
                                        suggestions: [{
                                            sourceId: 'product_description',
                                            targets: [{ sfccField: 'longDescription', confidence: 0.9, reason: 'desc' }]
                                        }]
                                    })
                                }
                            }]
                        },
                        text: ''
                    };
                }
            },
            '*/cartridge/scripts/migration/migrationPreferences': {
                getOpenAiConfig: function () {
                    return { enabled: true, apiKey: 'sk-test', model: 'gpt-4o-mini' };
                }
            }
        });
        var res = client.chatCompletions([{ role: 'user', content: 'map' }]);
        assert.isTrue(res.ok);
        assert.isObject(res.parsed);
        assert.equal(res.parsed.suggestions[0].sourceId, 'product_description');
    });
});
