'use strict';

var http = require('*/cartridge/scripts/migration/core/http');
var cfg  = require('*/cartridge/scripts/migration/configAccessor');

var BATCH_SIZE = 10;

function adminBase() {
    var c     = cfg.shopify || {};
    var store = String(c.storeUrl || '').replace(/\/$/, '');
    if (!store) {
        throw new Error('Shopify store URL is not configured. Please complete Step 1 (Test Connection) first.');
    }
    if (store.indexOf('http') !== 0) { store = 'https://' + store; }
    return store + '/admin/api/' + String(c.apiVersion || '2026-07');
}

function getToken() {
    var c     = cfg.shopify || {};
    var token = String(c.accessToken || c.clientSecret || '');
    if (!token) {
        throw new Error('Shopify access token is not configured. Please complete Step 1 (Test Connection) first.');
    }
    return token;
}

function authHeaders() {
    return { 'X-Shopify-Access-Token': getToken(), 'Content-Type': 'application/json' };
}

function productFields() {
    return ' id handle title bodyHtml vendor productType status tags'
        + ' seo { title description }'
        + ' variants(first: 50) { nodes { id sku price compareAtPrice barcode position'
        + '   selectedOptions { name value } image { url altText } } }'
        + ' images(first: 5) { nodes { url altText } }'
        + ' collections(first: 5) { nodes { id handle title } }'
        + ' metafields(first: 10) { nodes { namespace key value type } }';
}

/**
 * Return total number of Shopify products via the REST count endpoint.
 * @returns {number}
 */
function getCount() {
    var res = http.get(adminBase() + '/products/count.json', authHeaders());
    if (res.status !== 200) throw new Error('Shopify product count failed (' + res.status + ')');
    return (res.data && res.data.count) ? res.data.count : 0;
}

/**
 * Fetch one page of products via Shopify GraphQL with cursor-based pagination.
 * @param {string|null} cursor - opaque cursor from previous response (null for first page)
 * @param {number} limit
 * @returns {{ results: Array, total: null, nextCursor: string|null, hasMore: boolean }}
 */
function fetchBatch(cursor, limit) {
    var pageSize = limit || BATCH_SIZE;
    var after    = cursor ? ', after: "' + cursor + '"' : '';
    var query    = '{ products(first: ' + pageSize + after + ') {'
        + ' pageInfo { hasNextPage endCursor }'
        + ' nodes {' + productFields() + ' } } }';

    var res = http.post(
        adminBase() + '/graphql.json',
        authHeaders(),
        JSON.stringify({ query: query })
    );
    if (res.status !== 200 || !res.data || !res.data.data) {
        var gqlErr = '';
        if (res.data && res.data.errors && res.data.errors.length) {
            gqlErr = ': ' + res.data.errors[0].message;
        } else if (res.text) {
            gqlErr = ': ' + String(res.text).substring(0, 200);
        }
        throw new Error('Shopify products fetch failed (' + res.status + ')' + gqlErr);
    }
    var productsData = res.data.data.products || {};
    var nodes        = productsData.nodes     || [];
    var pageInfo     = productsData.pageInfo  || {};
    return {
        results:    nodes,
        total:      null,
        nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
        hasMore:    !!pageInfo.hasNextPage
    };
}

/**
 * Fetch a single Shopify product by handle, numeric ID, or GID.
 * @param {string} handleOrId
 * @returns {Object} Shopify product node
 */
function fetchById(handleOrId) {
    var s = String(handleOrId || '');
    var query;

    if (s.indexOf('gid://') === 0 || /^\d+$/.test(s)) {
        var gid = s.indexOf('gid://') === 0 ? s : 'gid://shopify/Product/' + s;
        query = '{ product(id: "' + gid + '") {' + productFields() + ' } }';
    } else {
        query = '{ products(first: 1, query: "handle:' + s.replace(/"/g, '\\"') + '") {'
            + ' nodes {' + productFields() + ' } } }';
    }

    var res = http.post(
        adminBase() + '/graphql.json',
        authHeaders(),
        JSON.stringify({ query: query })
    );
    if (res.status !== 200 || !res.data || !res.data.data) {
        throw new Error('Shopify product fetch failed for "' + handleOrId + '" (' + res.status + ')');
    }

    var product;
    if (res.data.data.product) {
        product = res.data.data.product;
    } else if (res.data.data.products && res.data.data.products.nodes && res.data.data.products.nodes.length) {
        product = res.data.data.products.nodes[0];
    }
    if (!product) {
        throw new Error('Shopify product not found: ' + handleOrId);
    }
    return product;
}

module.exports = { getCount: getCount, fetchBatch: fetchBatch, fetchById: fetchById };
