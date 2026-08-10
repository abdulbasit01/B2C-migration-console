'use strict';

var bigcommerceApi = require('*/cartridge/scripts/migration/core/bigcommerceApi');

var BATCH_SIZE = 50;
var INCLUDE_QS = 'include=variants,images,custom_fields';

/**
 * @returns {number}
 */
function getCount() {
    var page = bigcommerceApi.fetchPage('/catalog/products', 0, 1, null, {
        version:     'v3',
        queryParams: INCLUDE_QS
    });
    return page.total || 0;
}

/**
 * Fetch one page of products via BigCommerce V3 catalog API.
 * @param {number} offset
 * @param {number} [limit]
 * @returns {{ results: Array, total: number }}
 */
function fetchBatch(offset, limit) {
    return bigcommerceApi.fetchPage('/catalog/products', offset || 0, limit || BATCH_SIZE, null, {
        version:     'v3',
        queryParams: INCLUDE_QS
    });
}

/**
 * Fetch a single BigCommerce product by numeric ID or SKU.
 * @param {string} idOrSku
 * @returns {Object}
 */
function fetchById(idOrSku) {
    var s = String(idOrSku || '').trim();
    if (!s) throw new Error('BigCommerce product id/sku is required');

    var path;
    if (/^\d+$/.test(s)) {
        path = '/catalog/products/' + encodeURIComponent(s) + '?' + INCLUDE_QS;
    } else {
        path = '/catalog/products?sku=' + encodeURIComponent(s) + '&' + INCLUDE_QS;
    }

    var res  = bigcommerceApi.get(path, null, 'v3');
    var data = res.data;

    // Single-product endpoint returns { data: { ...product } }
    if (data && data.data && Object.prototype.toString.call(data.data) !== '[object Array]') {
        return data.data;
    }

    var list = bigcommerceApi.extractList(data);
    if (!list.length) {
        throw new Error('BigCommerce product not found: ' + idOrSku);
    }
    return list[0];
}

module.exports = { getCount: getCount, fetchBatch: fetchBatch, fetchById: fetchById };
