'use strict';

/* eslint-env mocha */

var assert     = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path       = require('path');

var fetcherPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/productMigration/ctpProductFetcher.js'
);

/**
 * Load the fetcher with platform and SFCC dependencies stubbed.
 * @param {Object} http HTTP stub
 * @returns {Object} fetcher module
 */
function loadFetcher(http) {
    return proxyquire(fetcherPath, {
        '*/cartridge/scripts/migration/core/http': http,
        '*/cartridge/scripts/migration/configAccessor': {
            ctp: {
                authUrl:     'https://auth.example.test',
                apiUrl:      'https://api.example.test',
                projectKey:  'project',
                clientId:    'client',
                clientSecret: 'secret',
                scopes:      ''
            }
        },
        'dw/crypto/Encoding': {
            toBase64: function () { return 'encoded'; }
        },
        'dw/util/Bytes': function (value) { return value; }
    });
}

/**
 * Build an HTTP stub with successful CT authentication.
 * @param {Function} getImpl GET implementation
 * @returns {Object} HTTP stub
 */
function httpStub(getImpl) {
    return {
        post: function () {
            return { status: 200, data: { access_token: 'token' } };
        },
        get: getImpl
    };
}

describe('ctpProductFetcher response-size pagination', function () {
    it('uses a safe default page size of 50', function () {
        var requestedUrl = '';
        var fetcher = loadFetcher(httpStub(function (url) {
            requestedUrl = url;
            return { status: 200, data: { results: [{ id: 'p1' }], total: 1 } };
        }));

        var page = fetcher.fetchBatch(0);

        assert.include(requestedUrl, '/products?limit=50&offset=0');
        assert.equal(page.pageSize, 50);
        assert.lengthOf(page.results, 1);
    });

    it('halves the page and retries the same offset after SFCC rejects a large response', function () {
        var urls = [];
        var calls = 0;
        var fetcher = loadFetcher(httpStub(function (url) {
            urls.push(url);
            calls += 1;
            if (calls === 1) {
                return {
                    status: 500,
                    data:   {},
                    text:   'IOException:HTTP response maximum size for memory processing of 10485760 bytes exceeded.'
                };
            }
            return { status: 200, data: { results: [{ id: 'p101' }], total: 400 } };
        }));

        var page = fetcher.fetchBatch(100, 50);

        assert.lengthOf(urls, 2);
        assert.include(urls[0], '/products?limit=50&offset=100');
        assert.include(urls[1], '/products?limit=25&offset=100');
        assert.equal(page.pageSize, 25);
    });

    it('also retries when the service helper throws the response-size error', function () {
        var calls = 0;
        var fetcher = loadFetcher(httpStub(function () {
            calls += 1;
            if (calls === 1) {
                throw new Error('IOException: HTTP response maximum size for memory processing of 10485760 bytes exceeded.');
            }
            return { status: 200, data: { results: [], total: 0 } };
        }));

        var page = fetcher.fetchBatch(0, 10);

        assert.equal(calls, 2);
        assert.equal(page.pageSize, 5);
    });

    it('does not retry unrelated upstream errors', function () {
        var calls = 0;
        var fetcher = loadFetcher(httpStub(function () {
            calls += 1;
            return { status: 401, data: {}, text: 'Unauthorized' };
        }));

        assert.throws(function () {
            fetcher.fetchBatch(0, 50);
        }, 'CT products fetch failed (401): Unauthorized');
        assert.equal(calls, 1);
    });

    it('reports when a single product still exceeds the SFCC response limit', function () {
        var fetcher = loadFetcher(httpStub(function () {
            return {
                status: 500,
                data:   {},
                text:   'HTTP response maximum size for memory processing of 10485760 bytes exceeded'
            };
        }));

        assert.throws(function () {
            fetcher.fetchBatch(7, 1);
        }, "CT product response exceeds SFCC's 10 MB HTTP limit even with a one-product page at offset 7");
    });
});
