'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var path = require('path');
var proxyquire = require('proxyquire').noCallThru();

var clientPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/sfccClient.js'
);

describe('sfccClient attribute definitions', function () {
    var originalRequest;

    beforeEach(function () {
        originalRequest = global.request;
        global.request = { httpHost: 'sandbox.example.com' };
    });

    afterEach(function () {
        global.request = originalRequest;
    });

    it('normalizes localizable, site-specific and value-type metadata', function () {
        var client = proxyquire(clientPath, {
            '*/cartridge/scripts/migration/core/serviceHttp': {
                get: function () {
                    return {
                        status: 200,
                        data: {
                            total: 2,
                            data: [{
                                id: 'packCount',
                                display_name: { default: 'Pack count' },
                                system: false,
                                localizable: false,
                                site_specific: false,
                                value_type: 'string'
                            }, {
                                id: 'localizedSize',
                                localizable: 'true',
                                site_specific: 1,
                                value_type: 'int'
                            }]
                        }
                    };
                }
            },
            '*/cartridge/scripts/migration/configAccessor': {
                sfcc: { bmClientId: 'client', metaVersion: 'v25_6' }
            },
            '*/cartridge/scripts/migration/sfccCredentialsAccessor': {
                bmUsername: 'user',
                bmPassword: 'password'
            },
            'dw/crypto/Encoding': { toBase64: function () { return 'encoded'; } },
            'dw/util/Bytes': function Bytes() {}
        });

        var definitions = client.getAttributeDefinitions('token', 'Product');

        assert.lengthOf(definitions, 2);
        assert.equal(definitions[0].id, 'packCount');
        assert.isFalse(definitions[0].localizable);
        assert.isFalse(definitions[0].siteSpecific);
        assert.equal(definitions[0].valueType, 'string');
        assert.equal(definitions[1].id, 'localizedSize');
        assert.isTrue(definitions[1].localizable);
        assert.isTrue(definitions[1].siteSpecific);
        assert.equal(definitions[1].valueType, 'int');
    });
    it('requests full definitions with select=(**) on every page', function () {
        // Without select, the OCAPI list returns only id/link: localizable, value_type,
        // site_specific and system would all be unknown (the mock above hides that).
        var urls = [];
        var client = proxyquire(clientPath, {
            '*/cartridge/scripts/migration/core/serviceHttp': {
                get: function (service, url) {
                    urls.push(url);
                    var start = Number((/[?&]start=(d+)/.exec(url) || [])[1] || 0);
                    return { status: 200, data: { total: 250, data: start === 0 ? new Array(200).fill({ id: 'a' }) : [{ id: 'b' }] } };
                }
            },
            '*/cartridge/scripts/migration/configAccessor': {
                sfcc: { bmClientId: 'client', metaVersion: 'v25_6' }
            },
            '*/cartridge/scripts/migration/sfccCredentialsAccessor': {
                bmUsername: 'user',
                bmPassword: 'password'
            },
            'dw/crypto/Encoding': { toBase64: function () { return 'encoded'; } },
            'dw/util/Bytes': function Bytes() {}
        });

        client.getAttributeDefinitions('token', 'Product');

        assert.lengthOf(urls, 2, 'two pages for 250 definitions');
        urls.forEach(function (url) {
            assert.include(url, 'select=(**)');
            assert.include(url, '/system_object_definitions/Product/attribute_definitions');
        });
    });
});
