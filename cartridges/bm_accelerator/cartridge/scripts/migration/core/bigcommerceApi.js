'use strict';

var serviceHttp = require('*/cartridge/scripts/migration/core/serviceHttp');
var cfg         = require('*/cartridge/scripts/migration/configAccessor');

/**
 * @param {Object} [override]
 * @returns {Object}
 */
function getCreds(override) {
    var c = override || cfg.bigcommerce || {};
    if (!c.storeHash) {
        throw new Error('BigCommerce store hash is not configured. Set it under Site Preferences → B2C Migration Console.');
    }
    if (!c.accessToken) {
        throw new Error('BigCommerce access token is not configured. Set it under Site Preferences → B2C Migration Console.');
    }
    return c;
}

/**
 * @param {Object} [creds]
 * @param {string} [version] - 'v2' or 'v3' (default from prefs / v3)
 * @returns {string}
 */
function getBaseUrl(creds, version) {
    var c   = getCreds(creds);
    var ver = version || c.apiVersion || 'v3';
    if (ver.indexOf('v') !== 0) {
        ver = 'v' + ver;
    }
    return 'https://api.bigcommerce.com/stores/' + String(c.storeHash).replace(/\/$/, '') + '/' + ver;
}

/**
 * @param {Object} [creds]
 * @returns {Object}
 */
function authHeaders(creds) {
    var c = getCreds(creds);
    var headers = {
        'X-Auth-Token': c.accessToken,
        Accept:         'application/json',
        'Content-Type': 'application/json'
    };
    if (c.clientId) {
        headers['X-Auth-Client'] = c.clientId;
    }
    return headers;
}

/**
 * @param {string} method
 * @param {string} url
 * @param {Object} headers
 * @param {string} [body]
 * @returns {{ status: number, data: Object|Array, text: string, link: string }}
 */
function send(method, url, headers, body) {
    return serviceHttp.request('bigcommerce', method, url, headers, body);
}

/**
 * @param {number} status
 * @param {Object|Array} data
 * @param {string} text
 * @returns {string}
 */
function errorDetail(status, data, text) {
    var detail = '';
    if (data) {
        if (data.title) detail = String(data.title);
        else if (data.message) detail = String(data.message);
        else if (data.error) detail = String(data.error);
        else if (typeof data === 'object') detail = JSON.stringify(data).substring(0, 200);
    }
    if (!detail && text) detail = String(text).substring(0, 200);
    return 'BigCommerce API failed (' + status + ')' + (detail ? ': ' + detail : '');
}

/**
 * @param {string} path - path after version base (e.g. /store or /catalog/products)
 * @param {Object} [creds]
 * @param {string} [version]
 * @returns {{ status: number, data: Object|Array, text: string }}
 */
function get(path, creds, version) {
    var url = getBaseUrl(creds, version) + (path.indexOf('/') === 0 ? path : '/' + path);
    var res = send('GET', url, authHeaders(creds));
    if (res.status >= 400) {
        throw new Error(errorDetail(res.status, res.data, res.text));
    }
    return res;
}

/**
 * Extract list payload from V2 array or V3 { data: [...] } responses.
 * @param {Object|Array} data
 * @param {string} [listKey]
 * @returns {Array}
 */
function extractList(data, listKey) {
    if (!data) return [];
    if (Object.prototype.toString.call(data) === '[object Array]') return data;
    if (listKey && data[listKey]) return data[listKey];
    if (data.data && Object.prototype.toString.call(data.data) === '[object Array]') return data.data;
    return [];
}

/**
 * Extract pagination meta from V3 responses.
 * @param {Object} data
 * @returns {{ total: number|null, totalPages: number|null, currentPage: number|null }}
 */
function extractMeta(data) {
    var meta = (data && data.meta && data.meta.pagination) ? data.meta.pagination : null;
    if (!meta) {
        return { total: null, totalPages: null, currentPage: null };
    }
    return {
        total:       meta.total != null ? meta.total : null,
        totalPages:  meta.total_pages != null ? meta.total_pages : null,
        currentPage: meta.current_page != null ? meta.current_page : null
    };
}

/**
 * Fetch all pages (V2 page/limit or V3 page/limit).
 * @param {string} path
 * @param {Object} [creds]
 * @param {Object} [opts] - { version, limit, listKey, queryParams, maxPages }
 * @returns {Array}
 */
function fetchAll(path, creds, opts) {
    var options  = opts || {};
    var version  = options.version || 'v3';
    var limit    = options.limit || 250;
    var page     = 1;
    var out      = [];
    var maxPages = options.maxPages || 200;
    var basePath = path.split('?')[0];
    var extraQs  = options.queryParams ? ('&' + options.queryParams) : '';

    while (page <= maxPages) {
        var qs  = 'limit=' + limit + '&page=' + page + extraQs;
        var res = get(basePath + '?' + qs, creds, version);
        var batch = extractList(res.data, options.listKey);
        out = out.concat(batch);

        if (version === 'v3' || version === '3') {
            var meta = extractMeta(res.data);
            if (meta.totalPages != null && page >= meta.totalPages) break;
            if (!batch.length) break;
        } else if (!batch.length || batch.length < limit) {
            break;
        }
        page++;
    }
    return out;
}

/**
 * Offset/limit page using page-based APIs.
 * @param {string} path
 * @param {number} offset
 * @param {number} limit
 * @param {Object} [creds]
 * @param {Object} [opts] - { version, listKey, queryParams, mapFn }
 * @returns {{ results: Array, total: number }}
 */
function fetchPage(path, offset, limit, creds, opts) {
    var options   = opts || {};
    var version   = options.version || 'v3';
    var pageSize  = Math.min(limit || 50, 250);
    var page      = Math.floor((offset || 0) / pageSize) + 1;
    var skipInPage = (offset || 0) % pageSize;
    var basePath  = path.split('?')[0];
    var extraQs   = options.queryParams ? ('&' + options.queryParams) : '';
    var qs        = 'limit=' + pageSize + '&page=' + page + extraQs;
    var res       = get(basePath + '?' + qs, creds, version);
    var batch     = extractList(res.data, options.listKey);
    var results   = [];
    var i;

    for (i = skipInPage; i < batch.length && results.length < limit; i++) {
        var item = options.mapFn ? options.mapFn(batch[i]) : batch[i];
        if (item) results.push(item);
    }

    var total = offset + results.length;
    if (version === 'v3' || version === '3') {
        var meta = extractMeta(res.data);
        if (meta.total != null) total = meta.total;
    }

    return { results: results, total: total };
}

/**
 * Probe store identity via V2 /store.
 * @param {Object} [creds]
 * @returns {Object}
 */
function getStore(creds) {
    var res = get('/store', creds, 'v2');
    return res.data || {};
}

/**
 * Convert decimal price to CT-like money shape used by shared transformers.
 * @param {string|number} price
 * @param {string} currency
 * @returns {Object}
 */
function priceToMoney(price, currency) {
    var n = parseFloat(String(price || '0'));
    if (isNaN(n)) n = 0;
    return {
        centAmount:     Math.round(n * 100),
        currencyCode:   currency || 'USD',
        fractionDigits: 2
    };
}

module.exports = {
    getCreds:     getCreds,
    getBaseUrl:   getBaseUrl,
    authHeaders:  authHeaders,
    send:         send,
    get:          get,
    extractList:  extractList,
    extractMeta:  extractMeta,
    fetchAll:     fetchAll,
    fetchPage:    fetchPage,
    getStore:     getStore,
    priceToMoney: priceToMoney
};
