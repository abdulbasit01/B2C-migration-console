'use strict';

var Encoding = require('dw/crypto/Encoding');
var Bytes    = require('dw/util/Bytes');
var http     = require('*/cartridge/scripts/migration/core/http');
var cfg      = require('*/cartridge/scripts/migration/configAccessor');

var DEFAULT_LIMIT   = 100;
var MAX_RETRIES     = 3;
var RETRY_DELAY_MS  = 500;

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function sleep(ms) {
    var start = Date.now();
    while (Date.now() - start < ms) { /* busy wait — SFCC has no setTimeout */ }
}

/**
 * Execute an HTTP call with retries on transient failures.
 * @param {Function} fn - function returning { status, data }
 * @returns {Object}
 */
function withRetry(fn) {
    var lastError = null;
    for (var attempt = 0; attempt < MAX_RETRIES; attempt++) {
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

/**
 * Authenticate with commercetools using client credentials.
 * @param {Object} [creds] - optional credential override
 * @returns {string} access token
 */
function authenticate(creds) {
    var c    = creds || cfg.ctp;
    var body = 'grant_type=client_credentials';

    var res = withRetry(function () {
        return http.post(
            c.authUrl + '/oauth/token',
            {
                Authorization:  'Basic ' + toBase64(c.clientId + ':' + c.clientSecret),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body
        );
    });

    if (res.status !== 200 || !res.data.access_token) {
        throw new Error('CTP auth failed (' + res.status + ')');
    }
    return res.data.access_token;
}

/**
 * Build ISO date string for N years ago from now.
 * @param {number} years
 * @returns {string}
 */
function dateYearsAgo(years) {
    var d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return d.toISOString();
}

/**
 * Fetch a single page of orders.
 * @param {string} token
 * @param {Object} options
 * @param {string} options.sinceDate - ISO date lower bound
 * @param {number} options.offset
 * @param {number} options.limit
 * @returns {Object} { results, total }
 */
function fetchOrdersPage(token, options) {
    var c     = cfg.ctp;
    var since = options.sinceDate;
    var offset = options.offset || 0;
    var limit  = options.limit || DEFAULT_LIMIT;
    var where  = encodeURIComponent('createdAt >= "' + since + '"');
    var sort   = encodeURIComponent('createdAt asc');
    var qs     = '?limit=' + limit + '&offset=' + offset + '&where=' + where + '&sort=' + sort;

    var res = withRetry(function () {
        return http.get(
            c.apiUrl + '/' + c.projectKey + '/orders' + qs,
            { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
        );
    });

    if (res.status !== 200) {
        throw new Error('Failed to fetch orders (' + res.status + ')');
    }

    return {
        results: res.data.results || [],
        total:   res.data.total || 0
    };
}

/**
 * Fetch orders by date range with pagination.
 * @param {Object} options
 * @param {number} options.years - 1, 2, or 3
 * @param {number} [options.maxCount] - optional cap on orders fetched
 * @param {Object} [options.creds] - optional credential override
 * @returns {Object[]} raw commercetools order objects
 */
function fetchOrdersByDateRange(options) {
    var years     = parseInt(String(options.years || 1), 10);
    var maxCount  = options.maxCount ? parseInt(String(options.maxCount), 10) : null;
    var token     = authenticate(options.creds);
    var sinceDate = dateYearsAgo(years);
    var all       = [];
    var offset    = 0;
    var total     = null;

    do {
        var page = fetchOrdersPage(token, { sinceDate: sinceDate, offset: offset, limit: DEFAULT_LIMIT });
        var results = page.results;
        if (total === null) total = page.total;

        for (var i = 0; i < results.length; i++) {
            all.push(results[i]);
            if (maxCount && all.length >= maxCount) {
                return all;
            }
        }
        offset += results.length;
    } while (offset < total && results.length > 0);

    return all;
}

module.exports = {
    authenticate:            authenticate,
    fetchOrdersByDateRange:  fetchOrdersByDateRange,
    fetchOrdersPage:         fetchOrdersPage,
    dateYearsAgo:            dateYearsAgo,
    DEFAULT_LIMIT:           DEFAULT_LIMIT,
    MAX_RETRIES:             MAX_RETRIES
};
