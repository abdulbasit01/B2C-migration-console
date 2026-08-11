'use strict';

/* eslint-env mocha */

var assert     = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path       = require('path');

var connectorPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/orders/connectors/ctpOrderConnector.js'
);

describe('ctpOrderConnector', function () {
    var httpCalls;
    var connector;

    beforeEach(function () {
        httpCalls = [];

        var httpStub = {
            get: function (url, headers) {
                httpCalls.push({ method: 'GET', url: url, headers: headers });
                if (url.indexOf('/orders') >= 0) {
                    return {
                        status: 200,
                        data: {
                            results: [{ id: 'order-1', orderNumber: '1001' }],
                            total:   1
                        }
                    };
                }
                return { status: 404, data: {} };
            },
            post: function (url, headers, body) {
                httpCalls.push({ method: 'POST', url: url, body: body });
                return { status: 200, data: { access_token: 'test-token' } };
            }
        };

        var configStub = {
            ctp: {
                projectKey:   'test-project',
                clientId:     'client-id',
                clientSecret: 'client-secret',
                authUrl:      'https://auth.example.com',
                apiUrl:       'https://api.example.com'
            }
        };

        connector = proxyquire(connectorPath, {
            '*/cartridge/scripts/migration/core/http': httpStub,
            '*/cartridge/scripts/migration/configAccessor': configStub,
            'dw/crypto/Encoding': {
                toBase64: function () { return 'encoded'; }
            },
            'dw/util/Bytes': function Bytes(str) { this.str = str; }
        });
    });

    it('should authenticate using client credentials', function () {
        var token = connector.authenticate();
        assert.equal(token, 'test-token');
        assert.equal(httpCalls[0].method, 'POST');
        assert.ok(httpCalls[0].url.indexOf('/oauth/token') >= 0);
        assert.ok(httpCalls[0].body.indexOf('grant_type=client_credentials') >= 0);
    });

    it('should fetch orders by date range with pagination', function () {
        var orders = connector.fetchOrdersByDateRange({ years: 1 });
        assert.equal(orders.length, 1);
        assert.equal(orders[0].orderNumber, '1001');

        var orderCall = httpCalls.filter(function (c) { return c.method === 'GET'; })[0];
        assert.ok(orderCall.url.indexOf('/orders') >= 0);
        assert.ok(orderCall.url.indexOf('where=') >= 0);
        assert.ok(orderCall.headers.Authorization.indexOf('Bearer test-token') >= 0);
    });

    it('should respect maxCount limit', function () {
        var httpStub = {
            get: function () {
                return {
                    status: 200,
                    data: {
                        results: [
                            { id: '1', orderNumber: '1' },
                            { id: '2', orderNumber: '2' },
                            { id: '3', orderNumber: '3' }
                        ],
                        total: 3
                    }
                };
            },
            post: function () {
                return { status: 200, data: { access_token: 'token' } };
            }
        };

        var limited = proxyquire(connectorPath, {
            '*/cartridge/scripts/migration/core/http': httpStub,
            '*/cartridge/scripts/migration/configAccessor': { ctp: { projectKey: 'p', clientId: 'c', clientSecret: 's', authUrl: 'https://a', apiUrl: 'https://api' } },
            'dw/crypto/Encoding': { toBase64: function () { return 'x'; } },
            'dw/util/Bytes': function Bytes() {}
        });

        var orders = limited.fetchOrdersByDateRange({ years: 2, maxCount: 2 });
        assert.equal(orders.length, 2);
    });

    it('should retry on server errors', function () {
        var attempts = 0;
        var httpStub = {
            get: function () {
                attempts++;
                if (attempts < 2) {
                    return { status: 503, data: {} };
                }
                return {
                    status: 200,
                    data: { results: [{ id: '1' }], total: 1 }
                };
            },
            post: function () {
                return { status: 200, data: { access_token: 'token' } };
            }
        };

        var retryConnector = proxyquire(connectorPath, {
            '*/cartridge/scripts/migration/core/http': httpStub,
            '*/cartridge/scripts/migration/configAccessor': { ctp: { projectKey: 'p', clientId: 'c', clientSecret: 's', authUrl: 'https://a', apiUrl: 'https://api' } },
            'dw/crypto/Encoding': { toBase64: function () { return 'x'; } },
            'dw/util/Bytes': function Bytes() {}
        });

        var orders = retryConnector.fetchOrdersByDateRange({ years: 1 });
        assert.equal(orders.length, 1);
        assert.ok(attempts >= 2);
    });
});
