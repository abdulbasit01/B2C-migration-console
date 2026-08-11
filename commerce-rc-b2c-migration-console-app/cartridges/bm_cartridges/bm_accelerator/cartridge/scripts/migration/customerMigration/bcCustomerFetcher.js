'use strict';

var bigcommerceApi = require('*/cartridge/scripts/migration/core/bigcommerceApi');

var MAX_PAGE_SIZE = 250;

/**
 * Attach addresses to each customer via V3 /customers/addresses.
 * @param {Array} customers
 * @returns {Array}
 */
function attachAddresses(customers) {
    if (!customers || !customers.length) return customers || [];

    var ids = [];
    var i;
    for (i = 0; i < customers.length; i++) {
        if (customers[i] && customers[i].id != null) {
            ids.push(String(customers[i].id));
        }
    }
    if (!ids.length) return customers;

    // BigCommerce accepts customer_id:in=1,2,3 — chunk to keep URLs reasonable
    var byCustomer = {};
    var chunkSize  = 50;
    var c;
    for (c = 0; c < ids.length; c += chunkSize) {
        var chunk = ids.slice(c, c + chunkSize);
        var res = bigcommerceApi.get(
            '/customers/addresses?limit=250&customer_id:in=' + chunk.join(','),
            null,
            'v3'
        );
        var addrs = bigcommerceApi.extractList(res.data);
        var a;
        for (a = 0; a < addrs.length; a++) {
            var addr = addrs[a];
            var cid  = String(addr.customer_id);
            if (!byCustomer[cid]) byCustomer[cid] = [];
            byCustomer[cid].push(addr);
        }
    }

    for (i = 0; i < customers.length; i++) {
        var cust = customers[i];
        cust.addresses = byCustomer[String(cust.id)] || cust.addresses || [];
    }
    return customers;
}

/**
 * @returns {number} total customer count in the connected BigCommerce store
 */
function getCount() {
    var page = bigcommerceApi.fetchPage('/customers', 0, 1, null, { version: 'v3' });
    return page.total || 0;
}

/**
 * Fetch one page of customers using BigCommerce V3 page/limit pagination.
 * @param {number} offset
 * @param {number} [limit]
 * @returns {{ results: Array, total: number, nextOffset: number, hasMore: boolean }}
 */
function fetchPage(offset, limit) {
    var pageSize = Math.min(limit || MAX_PAGE_SIZE, MAX_PAGE_SIZE);
    var page     = bigcommerceApi.fetchPage('/customers', offset || 0, pageSize, null, {
        version: 'v3'
    });
    var results = attachAddresses(page.results || []);
    var nextOffset = (offset || 0) + results.length;
    return {
        results:    results,
        total:      page.total,
        nextOffset: nextOffset,
        hasMore:    results.length > 0 && nextOffset < page.total
    };
}

/**
 * Fetch a single customer from BigCommerce by numeric ID (includes addresses).
 * @param {string|number} bcId
 * @returns {Object|null}
 */
function fetchById(bcId) {
    var id = String(bcId || '').trim();
    if (!id) return null;

    var res = bigcommerceApi.get('/customers?id:in=' + encodeURIComponent(id), null, 'v3');
    var list = bigcommerceApi.extractList(res.data);
    if (!list.length) return null;

    var enriched = attachAddresses([list[0]]);
    return enriched[0] || null;
}

module.exports = {
    getCount:  getCount,
    fetchPage: fetchPage,
    fetchById: fetchById
};
