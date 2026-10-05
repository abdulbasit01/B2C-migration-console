'use strict';

/* eslint-env mocha */

var assert     = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru().noPreserveCache();
var path       = require('path');

var root = path.join(__dirname, '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration');

/**
 * SFCC catalog as the product migration imports it: masters named after the commercetools
 * product with variants {master}-{n}; bundles and single products under the product ID.
 * @returns {Object} dw/catalog/ProductMgr stub
 */
function productMgr() {
    var catalog = {};
    /**
     * @param {string} id - product ID
     * @param {string} sku - manufacturer SKU
     * @param {string[]} [variants] - variant IDs when this is a master
     */
    function add(id, sku, variants) {
        catalog[id] = {
            ID: id,
            manufacturerSKU: sku,
            master: !!variants,
            getVariants: function () {
                var list = (variants || []).map(function (v) { return catalog[v]; });
                var i = 0;
                return { iterator: function () {
                    return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } };
                } };
            }
        };
    }
    add('p-master', '', ['p-master-1', 'p-master-2']);
    add('p-master-1', 'SKU-A');
    add('p-master-2', 'SKU-B');
    add('p-bundle', 'BUNDLE-1');
    add('p-space', '', ['p-space-1']);
    add('p-space-1', ' SPACE-1');
    return { getProduct: function (id) { return catalog[id] || null; } };
}

/**
 * Load the fetcher against stubbed commercetools inventory and GraphQL endpoints.
 * @param {Object[]} entries - inventory entries the inventory endpoint returns
 * @param {Object} [opts] - { graphqlStatus, graphqlErrors }
 * @returns {Object} { fetcher, graphqlBodies }
 */
function load(entries, opts) {
    var o = opts || {};
    var graphqlBodies = [];
    var products = [
        { id: 'p-master', key: 'master', masterVariant: { id: 1, sku: 'SKU-A' }, variants: [{ id: 2, sku: 'SKU-B' }] },
        { id: 'p-bundle', key: 'bundle', masterVariant: { id: 1, sku: 'BUNDLE-1' }, variants: [{ id: 2, sku: 'BUNDLE-2' }] },
        { id: 'p-space', key: 'space', masterVariant: { id: 1, sku: ' SPACE-1' }, variants: [] }
    ];
    var http = {
        get: function () {
            return { status: 200, data: { results: entries, total: entries.length } };
        },
        post: function (url, headers, body) {
            if (url.indexOf('/oauth/token') >= 0) return { status: 200, data: { access_token: 't' } };
            graphqlBodies.push(JSON.parse(body));
            if (o.graphqlStatus || o.graphqlErrors) {
                return { status: o.graphqlStatus || 200, data: { errors: o.graphqlErrors || [] } };
            }
            var where = JSON.parse(body).variables.where;
            var results = products.filter(function (p) {
                return [p.masterVariant].concat(p.variants).some(function (v) { return where.indexOf(JSON.stringify(v.sku)) >= 0; });
            }).map(function (p) {
                return { id: p.id, key: p.key, masterData: { current: { masterVariant: p.masterVariant, variants: p.variants }, staged: null } };
            });
            return { status: 200, data: { data: { products: { results: results } } } };
        }
    };
    var resolver = proxyquire(path.join(root, 'orders/productIdResolver.js'), { 'dw/catalog/ProductMgr': productMgr() });
    var fetcher = proxyquire(path.join(root, 'inventoryMigration/ctpInventoryFetcher.js'), {
        '*/cartridge/scripts/migration/core/http': http,
        '*/cartridge/scripts/migration/configAccessor': { ctp: { projectKey: 'p', authUrl: 'https://auth', apiUrl: 'https://api' } },
        'dw/crypto/Encoding': { toBase64: function () { return 'x'; } },
        'dw/util/Bytes': function Bytes() {},
        '*/cartridge/scripts/migration/orders/productIdResolver': resolver
    });
    return { fetcher: fetcher, graphqlBodies: graphqlBodies };
}

describe('ctpInventoryFetcher SFCC product IDs', function () {
    it('sets the SFCC product of each SKU: variant {master}-{n}, bundle by product ID', function () {
        var entries = [{ sku: 'SKU-A' }, { sku: 'SKU-B' }, { sku: 'BUNDLE-1' }];
        var env = load(entries);
        var batch = env.fetcher.fetchBatch(0, 500, '', 'id');
        assert.deepEqual(batch.results.map(function (e) { return e.sfccProductId; }), ['p-master-1', 'p-master-2', 'p-bundle']);
        assert.lengthOf(env.graphqlBodies, 1);
    });

    it("gives a bundle's stock from its master variant only (one record per SFCC product)", function () {
        var env = load([{ sku: 'BUNDLE-1' }, { sku: 'BUNDLE-2' }]);
        var batch = env.fetcher.fetchBatch(0, 500, '', 'id');
        assert.strictEqual(batch.results[0].sfccProductId, 'p-bundle');
        assert.strictEqual(batch.results[1].sfccProductId, '');
    });

    it("marks SKUs with no SFCC product as '' (the SKU is kept later)", function () {
        var env = load([{ sku: 'ORPHAN' }, { sku: 'SKU-A' }]);
        var batch = env.fetcher.fetchBatch(0, 500, '', 'id');
        assert.strictEqual(batch.results[0].sfccProductId, '');
        assert.strictEqual(batch.results[1].sfccProductId, 'p-master-1');
    });

    it('looks SKUs up exactly as commercetools stores them, including a leading space', function () {
        var env = load([{ sku: ' SPACE-1' }]);
        var batch = env.fetcher.fetchBatch(0, 500, '', 'id');
        assert.strictEqual(batch.results[0].sfccProductId, 'p-space-1');
        assert.include(env.graphqlBodies[0].variables.where, '" SPACE-1"');
    });

    it('asks for 100 SKUs per GraphQL request', function () {
        var entries = [];
        for (var i = 0; i < 250; i++) entries.push({ sku: 'S' + i });
        var env = load(entries);
        env.fetcher.fetchBatch(0, 500, '', 'id');
        assert.lengthOf(env.graphqlBodies, 3);
        assert.include(env.graphqlBodies[0].query, 'masterVariant { id sku }');
    });

    it('stops with a clear error when the product lookup fails', function () {
        var env = load([{ sku: 'SKU-A' }], { graphqlErrors: [{ message: 'Insufficient scope' }] });
        assert.throws(function () { env.fetcher.fetchBatch(0, 500, '', 'id'); }, /product lookup for inventory SKUs failed.*Insufficient scope/);
    });
});
