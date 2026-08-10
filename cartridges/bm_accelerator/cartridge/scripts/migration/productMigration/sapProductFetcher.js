'use strict';

/**
 * SAP Commerce Cloud (Hybris) product fetcher — OCC v2 REST API.
 * Mirrors the ctpProductFetcher contract: getCount / fetchBatch(offset, limit) / fetchById.
 * SAP OCC's /products/search endpoint is offset-paged (currentPage/pageSize), like CT —
 * no cursor handling needed here.
 *
 * NOTE: query params below (query, fields) are the standard OCC ProductSearchController
 * shape but have not been verified against a live instance yet (no working credentials
 * at the time this was written) — revisit once Data Wizard → Test Connection succeeds.
 */

var sapApi = require('*/cartridge/scripts/migration/core/sapApi');

/**
 * @returns {number}
 */
function getCount() {
    var res = sapApi.get('/products/search?query=%3Arelevance&pageSize=1&fields=BASIC');
    var pagination = res.data.pagination || {};
    return pagination.totalResults || 0;
}

/**
 * @param {number} offset
 * @param {number} limit
 * @returns {{ results: Array, total: number }}
 */
function fetchBatch(offset, limit) {
    var pageSize    = limit || 100;
    var currentPage = Math.floor((offset || 0) / pageSize);

    var res = sapApi.get('/products/search?query=%3Arelevance'
        + '&currentPage=' + currentPage
        + '&pageSize='    + pageSize
        + '&fields=FULL');

    var pagination = res.data.pagination || {};
    return {
        results: res.data.products || [],
        total:   pagination.totalResults || 0
    };
}

/**
 * @param {string} productCode
 * @returns {Object} OCC product detail
 */
function fetchById(productCode) {
    var res = sapApi.get('/products/' + encodeURIComponent(productCode) + '?fields=FULL');
    if (!res.data || !res.data.code) {
        throw new Error('SAP Commerce product not found: ' + productCode);
    }
    return res.data;
}

module.exports = { getCount: getCount, fetchBatch: fetchBatch, fetchById: fetchById };
