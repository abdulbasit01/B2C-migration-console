'use strict';

var http      = require('*/cartridge/scripts/migration/core/http');
var connector = require('*/cartridge/scripts/migration/connectors/shopify/shopifyConnector');
var cfg       = require('*/cartridge/scripts/migration/configAccessor');

var MAX_PAGE_SIZE = 250;

/**
 * Parse the Shopify Link response header for the "next" page cursor.
 * Format: <https://store/admin/api/2025-01/customers.json?limit=250&page_info=xyz>; rel="next"
 * @param {string} linkHeader
 * @returns {string|null}
 */
function parseNextPageInfo(linkHeader) {
    if (!linkHeader) return null;
    var parts = String(linkHeader).split(',');
    for (var i = 0; i < parts.length; i++) {
        if (parts[i].indexOf('rel="next"') === -1) continue;
        var match = parts[i].match(/page_info=([^&>]+)/);
        return match ? match[1] : null;
    }
    return null;
}

/**
 * @returns {number} total customer count in the connected Shopify store
 */
function getCount() {
    var c   = cfg.shopify;
    var res = http.get(connector.getAdminBase(c) + '/customers/count.json', connector.getAuthHeaders(c));
    if (res.status !== 200) {
        throw new Error('Shopify customer count failed (' + res.status + ')');
    }
    return res.data.count || 0;
}

/**
 * Fetch one page of customers using Shopify's cursor-based pagination.
 * @param {string|null} pageInfo - cursor from a previous page's "next" link, or null for the first page
 * @param {number} [limit] - page size (max 250)
 * @returns {{ results: Array, nextPageInfo: string|null }}
 */
function fetchPage(pageInfo, limit) {
    var c  = cfg.shopify;
    var qs = '?limit=' + (limit || MAX_PAGE_SIZE);
    if (pageInfo) {
        qs += '&page_info=' + encodeURIComponent(pageInfo);
    }
    var res = http.get(connector.getAdminBase(c) + '/customers.json' + qs, connector.getAuthHeaders(c));
    if (res.status !== 200) {
        throw new Error('Shopify customers fetch failed (' + res.status + ')');
    }
    return {
        results:      res.data.customers || [],
        nextPageInfo: parseNextPageInfo(res.link)
    };
}

/**
 * Fetch a single customer from Shopify by their numeric ID.
 * @param {string|number} shopifyId
 * @returns {Object|null} Shopify customer object, or null if not found (404)
 */
function fetchById(shopifyId) {
    var c    = cfg.shopify;
    var id   = String(shopifyId || '').trim();
    var res  = http.get(connector.getAdminBase(c) + '/customers/' + encodeURIComponent(id) + '.json', connector.getAuthHeaders(c));
    if (res.status === 404) return null;
    if (res.status !== 200) {
        throw new Error('Shopify customer fetch failed (' + res.status + ') for id: ' + id);
    }
    return res.data.customer || null;
}

module.exports = {
    getCount:  getCount,
    fetchPage: fetchPage,
    fetchById: fetchById
};
