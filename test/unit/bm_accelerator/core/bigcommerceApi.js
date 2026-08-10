'use strict';

/* eslint-env mocha */

var assert     = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path       = require('path');

var apiPath = path.join(
    __dirname,
    '../../../../cartridges/bm_accelerator/cartridge/scripts/migration/core/bigcommerceApi.js'
);

describe('bigcommerceApi', function () {
    var api;

    beforeEach(function () {
        api = proxyquire(apiPath, {
            '*/cartridge/scripts/migration/core/serviceHttp': {
                request: function () {
                    return { status: 200, data: {}, text: '' };
                }
            },
            '*/cartridge/scripts/migration/configAccessor': {
                bigcommerce: {
                    storeHash:   'abc123',
                    accessToken: 'token',
                    clientId:    'client',
                    apiVersion:  'v3'
                }
            }
        });
    });

    it('builds V3 base URL from store hash', function () {
        assert.equal(
            api.getBaseUrl(null, 'v3'),
            'https://api.bigcommerce.com/stores/abc123/v3'
        );
    });

    it('builds auth headers with X-Auth-Token and optional client', function () {
        var headers = api.authHeaders();
        assert.equal(headers['X-Auth-Token'], 'token');
        assert.equal(headers['X-Auth-Client'], 'client');
        assert.equal(headers.Accept, 'application/json');
    });

    it('extracts V3 list data', function () {
        var list = api.extractList({ data: [{ id: 1 }, { id: 2 }] });
        assert.lengthOf(list, 2);
    });

    it('converts prices to money shape', function () {
        var money = api.priceToMoney('12.34', 'USD');
        assert.equal(money.centAmount, 1234);
        assert.equal(money.currencyCode, 'USD');
    });
});
