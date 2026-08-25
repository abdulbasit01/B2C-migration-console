'use strict';

var shopifyApi = require('*/cartridge/scripts/migration/core/shopifyApi');

var DEFAULT_LIMIT  = 100;
var MAX_RETRIES    = 3;
var RETRY_DELAY_MS = 500;
var _orderCountCache = {};

function sleep(ms) {
    var start = Date.now();
    while (Date.now() - start < ms) { /* busy wait */ }
}

function withRetry(fn) {
    var lastError = null;
    var attempt;
    for (attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            var res = fn();
            if (res.status === 429 || res.status >= 500) {
                lastError = new Error('HTTP ' + res.status);
                sleep(RETRY_DELAY_MS * (attempt + 1));
                continue;
            }
            return res;
        } catch (e) {
            lastError = e;
            sleep(RETRY_DELAY_MS * (attempt + 1));
        }
    }
    throw lastError || new Error('Request failed after retries');
}

function authenticate(creds) {
    return shopifyApi.getAccessToken(creds || shopifyApi.getCreds());
}

function dateYearsAgo(years) {
    var d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return d.toISOString();
}

/**
 * Map UI orderState filter to Shopify financial_status.
 * @param {string} orderState
 * @returns {string}
 */
function mapFinancialStatus(orderState) {
    if (!orderState) return '';
    var map = {
        Open:      'pending',
        Confirmed: 'authorized',
        Complete:  'paid',
        Cancelled: 'voided',
        pending:   'pending',
        authorized: 'authorized',
        paid:      'paid',
        voided:    'voided',
        refunded:  'refunded'
    };
    return map[orderState] || String(orderState).toLowerCase();
}

/**
 * Map UI paymentState filter to Shopify fulfillment_status.
 * @param {string} paymentState
 * @returns {string}
 */
function mapFulfillmentStatus(paymentState) {
    if (!paymentState) return '';
    var map = {
        Pending:    'unshipped',
        Paid:       'shipped',
        Failed:     'unshipped',
        unshipped:  'unshipped',
        shipped:    'shipped',
        partial:    'partial',
        fulfilled:  'fulfilled'
    };
    return map[paymentState] || String(paymentState).toLowerCase();
}

function buildOrdersQuery(options) {
    var parts = ['status=any'];
    if (options.sinceDate) {
        parts.push('created_at_min=' + encodeURIComponent(options.sinceDate));
    }
    var financial = mapFinancialStatus(options.orderState);
    if (financial) {
        parts.push('financial_status=' + encodeURIComponent(financial));
    }
    var fulfillment = mapFulfillmentStatus(options.paymentState);
    if (fulfillment) {
        parts.push('fulfillment_status=' + encodeURIComponent(fulfillment));
    }
    return parts.join('&');
}

/**
 * @param {string} token
 * @param {Object} options
 * @returns {{ results: Array, total: number }}
 */
function fetchOrdersPage(token, options) {
    var offset = options.offset || 0;
    var limit  = options.limit || DEFAULT_LIMIT;
    var qs     = buildOrdersQuery(options) + '&limit=' + limit;

    if (offset > 0) {
        qs += '&since_id=' + offset;
    }

    var res = withRetry(function () {
        return shopifyApi.send(
            'GET',
            shopifyApi.adminBase() + '/orders.json?' + qs,
            shopifyApi.authHeaders()
        );
    });

    if (res.status !== 200) {
        throw new Error('Failed to fetch Shopify orders (' + res.status + ')');
    }

    var orders = res.data.orders || [];
    var total  = orders.length;

    return {
        results: orders,
        total:   total
    };
}

function countCacheKey(options) {
    return [
        options.years || 1,
        options.orderState || '',
        options.paymentState || '',
        options.sinceDate || ''
    ].join('|');
}

/**
 * Count orders — paginate through all matching orders.
 * @param {Object} options
 * @returns {{ total: number, exportCount: number }}
 */
function countOrders(options) {
    var cacheKey = countCacheKey(options);
    if (_orderCountCache[cacheKey]) {
        return _orderCountCache[cacheKey];
    }

    var years     = parseInt(String(options.years || 1), 10);
    var maxCount  = options.maxCount ? parseInt(String(options.maxCount), 10) : null;
    var sinceDate = dateYearsAgo(years);
    var total     = 0;
    var pageInfo  = null;
    var qs        = buildOrdersQuery({ sinceDate: sinceDate, orderState: options.orderState, paymentState: options.paymentState })
        + '&limit=250';

    do {
        var url = shopifyApi.adminBase() + '/orders.json?' + qs;
        if (pageInfo) {
            url = shopifyApi.adminBase() + '/orders.json?limit=250&page_info=' + pageInfo;
        }
        var res   = withRetry(function () {
            return shopifyApi.send('GET', url, shopifyApi.authHeaders());
        });
        if (res.status !== 200) {
            throw new Error('Shopify order count failed (' + res.status + ')');
        }
        var batch = res.data.orders || [];
        total    += batch.length;
        pageInfo  = shopifyApi.parseNextPageInfo(res.link);
    } while (pageInfo);

    var exportCount = total;
    if (maxCount && maxCount > 0 && maxCount < total) {
        exportCount = maxCount;
    }

    var result = { total: total, exportCount: exportCount };
    _orderCountCache[cacheKey] = result;
    return result;
}

/**
 * Fetch orders using offset/limit semantics for the migration runner.
 * @param {string} token
 * @param {Object} options
 * @returns {{ results: Array, total: number }}
 */
function fetchOrdersPageByOffset(token, options) {
    var years     = parseInt(String(options.years || 1), 10);
    var sinceDate = options.sinceDate || dateYearsAgo(years);
    var offset    = options.offset || 0;
    var limit     = options.limit || DEFAULT_LIMIT;
    var skipped   = 0;
    var collected = [];
    var pageInfo  = null;
    var total     = null;
    var qs        = buildOrdersQuery({
        sinceDate:    sinceDate,
        orderState:   options.orderState,
        paymentState: options.paymentState
    }) + '&limit=250';

    do {
        var url = shopifyApi.adminBase() + '/orders.json?' + qs;
        if (pageInfo) {
            url = shopifyApi.adminBase() + '/orders.json?limit=250&page_info=' + pageInfo;
        }
        var res   = withRetry(function () {
            return shopifyApi.send('GET', url, shopifyApi.authHeaders());
        });
        if (res.status !== 200) {
            throw new Error('Failed to fetch Shopify orders (' + res.status + ')');
        }
        var batch = res.data.orders || [];
        var i;
        for (i = 0; i < batch.length; i++) {
            if (skipped < offset) {
                skipped++;
                continue;
            }
            collected.push(batch[i]);
            if (collected.length >= limit) {
                pageInfo = null;
                break;
            }
        }
        if (total === null) {
            var counts = countOrders({
                years:        years,
                orderState:   options.orderState,
                paymentState: options.paymentState
            });
            total = counts.total;
        }
        if (collected.length >= limit) break;
        pageInfo = shopifyApi.parseNextPageInfo(res.link);
        if (!batch.length) pageInfo = null;
    } while (pageInfo);

    return {
        results: collected,
        total:   total || (offset + collected.length)
    };
}

module.exports = {
    authenticate:           authenticate,
    fetchOrdersPage:        fetchOrdersPageByOffset,
    countOrders:            countOrders,
    buildOrdersWhere:       buildOrdersQuery,
    dateYearsAgo:           dateYearsAgo,
    DEFAULT_LIMIT:          DEFAULT_LIMIT,
    MAX_RETRIES:            MAX_RETRIES
};
