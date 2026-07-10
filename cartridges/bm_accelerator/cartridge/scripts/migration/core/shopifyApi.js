'use strict';

var HTTPClient = require('dw/net/HTTPClient');
var cfg        = require('*/cartridge/scripts/migration/configAccessor');

var _cachedToken    = null;
var _tokenExpiresAt = 0;

var OAUTH_ERROR_MESSAGES = {
    app_not_installed:  'This app is not installed on the store. In Shopify Partners, open your app and install it on this shop, then try again.',
    shop_not_permitted: 'Client credentials cannot be used on this store. Install the app on the shop first, or use an Admin API access token (shpat_…) in the Secret field.',
    invalid_client:     'Invalid Client ID or Secret. Copy both values from the same app in Shopify Partners / Dev Dashboard.'
};

/**
 * @param {string} val
 * @returns {boolean}
 */
function isDirectToken(val) {
    var s = String(val || '');
    return s.indexOf('shpat_') === 0 || s.indexOf('shpua_') === 0;
}

/**
 * @param {number} status
 * @param {string} text
 * @param {Object} data
 * @returns {string}
 */
function parseOAuthError(status, text, data) {
    if (data && data.error_description) {
        return String(data.error_description);
    }
    if (data && data.error) {
        return OAUTH_ERROR_MESSAGES[data.error] || ('Shopify OAuth error: ' + data.error);
    }
    var htmlMatch = String(text || '').match(/Oauth error ([^:<]+)/i);
    if (htmlMatch) {
        var code = htmlMatch[1].trim();
        return OAUTH_ERROR_MESSAGES[code] || ('Shopify OAuth error: ' + code);
    }
    return 'Shopify token request failed (' + status + '). Check Store URL, Client ID, and Secret.';
}

/**
 * @param {Object} [override]
 * @returns {Object}
 */
function getCreds(override) {
    var c = override || cfg.shopify || {};
    if (!c.storeUrl) {
        throw new Error('Shopify credentials are not configured. Connect in Data Wizard Step 1.');
    }
    if (c.accessToken || isDirectToken(c.clientSecret)) {
        return c;
    }
    if (!c.clientId || !c.clientSecret) {
        throw new Error('Enter Store URL with Client ID and Secret, or paste an Admin API access token (shpat_…) in the Secret field.');
    }
    return c;
}

/**
 * Exchange client ID/secret for a short-lived access token (Dev Dashboard apps).
 * @param {Object} creds
 * @returns {string}
 */
function fetchAccessToken(creds) {
    if (_cachedToken && Date.now() < _tokenExpiresAt - 60000) {
        return _cachedToken;
    }

    var c     = getCreds(creds);
    var store = (c.storeUrl || '').replace(/\/$/, '');
    var body  = 'grant_type=client_credentials'
        + '&client_id='     + encodeURIComponent(c.clientId)
        + '&client_secret=' + encodeURIComponent(c.clientSecret);

    var client = new HTTPClient();
    client.setTimeout(30000);
    client.open('POST', store + '/admin/oauth/access_token');
    client.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    client.send(body);

    var text = client.getText() || '';
    var data = {};
    try { data = JSON.parse(text || '{}'); } catch (e) { /* ignore */ }

    if (client.getStatusCode() !== 200 || !data.access_token) {
        throw new Error(parseOAuthError(client.getStatusCode(), text, data));
    }

    _cachedToken    = data.access_token;
    _tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return _cachedToken;
}

/**
 * Resolve token — direct shpat_ token or OAuth client credentials exchange.
 * @param {Object} [creds]
 * @returns {string}
 */
function getAccessToken(creds) {
    var c = getCreds(creds);
    if (c.accessToken) {
        return c.accessToken;
    }
    if (isDirectToken(c.clientSecret)) {
        return c.clientSecret;
    }
    return fetchAccessToken(creds);
}

/**
 * @param {Object} creds
 * @returns {string}
 */
function adminBase(creds) {
    var c       = getCreds(creds);
    var store   = (c.storeUrl || '').replace(/\/$/, '');
    var version = c.apiVersion || '2025-01';
    return store + '/admin/api/' + version;
}

/**
 * @param {Object} creds
 * @returns {Object}
 */
function authHeaders(creds) {
    return {
        'X-Shopify-Access-Token': getAccessToken(creds),
        'Content-Type':           'application/json'
    };
}

/**
 * @param {string} method
 * @param {string} url
 * @param {Object} headers
 * @param {string} [body]
 * @returns {{ status: number, data: Object, text: string, link: string }}
 */
function send(method, url, headers, body) {
    var client = new HTTPClient();
    client.setTimeout(60000);
    client.open(method, url);

    var keys = Object.keys(headers || {});
    var i;
    for (i = 0; i < keys.length; i++) {
        client.setRequestHeader(keys[i], headers[keys[i]]);
    }

    client.send(body !== undefined ? String(body) : '');

    var text = client.getText() || '';
    var data = {};
    try { data = JSON.parse(text || '{}'); } catch (e) { /* ignore */ }

    return {
        status: client.getStatusCode(),
        data:   data,
        text:   text,
        link:   client.getResponseHeader('Link') || ''
    };
}

/**
 * @param {string} path - path after admin base (e.g. /shop.json)
 * @param {Object} [creds]
 * @returns {{ status: number, data: Object, text: string, link: string }}
 */
function get(path, creds) {
    var res = send('GET', adminBase(creds) + path, authHeaders(getCreds(creds)));
    if (res.status >= 400) {
        var detail = '';
        if (res.data && res.data.errors) {
            detail = JSON.stringify(res.data.errors).substring(0, 200);
        } else if (res.text) {
            detail = res.text.substring(0, 200);
        }
        throw new Error('Shopify API failed (' + res.status + ')' + (detail ? ': ' + detail : ''));
    }
    return res;
}

/**
 * Execute an Admin GraphQL query.
 * @param {string} query
 * @param {Object} [variables]
 * @param {Object} [creds]
 * @returns {Object} data payload (res.data.data)
 */
function graphql(query, variables, creds) {
    var body = JSON.stringify({ query: query, variables: variables || {} });
    var res  = send('POST', adminBase(creds) + '/graphql.json', authHeaders(getCreds(creds)), body);
    if (res.status >= 400) {
        var httpDetail = '';
        if (res.data && res.data.errors) {
            httpDetail = JSON.stringify(res.data.errors).substring(0, 200);
        } else if (res.text) {
            httpDetail = res.text.substring(0, 200);
        }
        throw new Error('Shopify GraphQL failed (' + res.status + ')' + (httpDetail ? ': ' + httpDetail : ''));
    }
    if (res.data.errors && res.data.errors.length) {
        throw new Error('Shopify GraphQL error: ' + (res.data.errors[0].message || String(res.data.errors[0])));
    }
    return res.data.data || {};
}

/**
 * @param {string} linkHeader
 * @returns {string|null}
 */
function parseNextPageInfo(linkHeader) {
    if (!linkHeader) return null;
    var parts = linkHeader.split(',');
    var i;
    for (i = 0; i < parts.length; i++) {
        if (parts[i].indexOf('rel="next"') >= 0) {
            var m = parts[i].match(/page_info=([^>&]+)/);
            return m ? m[1] : null;
        }
    }
    return null;
}

/**
 * @param {string} path - e.g. /products.json
 * @param {string} listKey - e.g. products
 * @param {Object} [creds]
 * @param {Object} [opts] - { limit, queryParams }
 * @returns {Array}
 */
function fetchAll(path, listKey, creds, opts) {
    var options  = opts || {};
    var limit    = options.limit || 250;
    var pageInfo = null;
    var out      = [];
    var basePath = path.indexOf('?') >= 0 ? path : path + '?limit=' + limit;
    if (options.queryParams) {
        basePath += (basePath.indexOf('?') >= 0 ? '&' : '?') + options.queryParams;
    }

    do {
        var url = adminBase(creds) + basePath;
        if (pageInfo) {
            url = adminBase(creds) + path.split('?')[0] + '?limit=' + limit + '&page_info=' + pageInfo;
        }
        var res   = send('GET', url, authHeaders(getCreds(creds)));
        if (res.status >= 400) {
            throw new Error('Shopify API failed (' + res.status + ')');
        }
        var batch = res.data[listKey] || [];
        out       = out.concat(batch);
        pageInfo  = parseNextPageInfo(res.link);
    } while (pageInfo);

    return out;
}

/**
 * All active Shopify locations for inventory export (includes legacy fulfillment
 * locations such as Snow City Warehouse that are omitted from store migration).
 * @param {Object} [creds]
 * @returns {Array}
 */
function fetchInventoryLocations(creds) {
    var locations = fetchAll('/locations.json', 'locations', creds);
    var out       = [];
    var i;

    for (i = 0; i < locations.length; i++) {
        var loc = locations[i];
        if (loc.active !== false) {
            out.push(loc);
        }
    }

    return out;
}

/**
 * Active merchant-managed locations from Shopify.
 * REST /locations.json also returns legacy fulfillment-service locations
 * (legacy: true) that are hidden from the Shopify Admin locations UI.
 * @param {Object} [creds]
 * @returns {Array}
 */
function fetchMerchantLocations(creds) {
    var locations = fetchAll('/locations.json', 'locations', creds);
    var out       = [];
    var i;

    for (i = 0; i < locations.length; i++) {
        var loc = locations[i];
        if (loc.active !== false && loc.legacy !== true) {
            out.push(loc);
        }
    }

    return out;
}

/**
 * Paginate a Shopify list using offset/limit semantics (skip + take).
 * @param {string} path
 * @param {string} listKey
 * @param {number} offset
 * @param {number} limit
 * @param {Object} [creds]
 * @param {Object} [opts] - { queryParams, mapFn }
 * @returns {{ results: Array, total: number }}
 */
function fetchPage(path, listKey, offset, limit, creds, opts) {
    var options   = opts || {};
    var pageLimit = 250;
    var skipped   = 0;
    var collected = [];
    var pageInfo  = null;
    var total     = null;
    var baseQs    = 'limit=' + pageLimit;
    if (options.queryParams) {
        baseQs += '&' + options.queryParams;
    }
    var basePath = path.split('?')[0];

    do {
        var url = adminBase(creds) + basePath + '?' + baseQs;
        if (pageInfo) {
            url = adminBase(creds) + basePath + '?limit=' + pageLimit + '&page_info=' + pageInfo;
        }
        var res   = send('GET', url, authHeaders(getCreds(creds)));
        if (res.status >= 400) {
            throw new Error('Shopify API failed (' + res.status + ')');
        }
        var batch = res.data[listKey] || [];
        var bi;
        for (bi = 0; bi < batch.length; bi++) {
            if (skipped < offset) {
                skipped++;
                continue;
            }
            var item = options.mapFn ? options.mapFn(batch[bi]) : batch[bi];
            if (item) collected.push(item);
            if (collected.length >= limit) {
                pageInfo = null;
                break;
            }
        }
        if (total === null && res.link) {
            total = skipped + batch.length;
        }
        pageInfo = parseNextPageInfo(res.link);
        if (collected.length >= limit) break;
        if (!batch.length) pageInfo = null;
    } while (pageInfo);

    if (total === null) {
        total = offset + collected.length;
    }

    return { results: collected, total: total };
}

/**
 * @param {Object} [creds]
 * @returns {Object}
 */
function getShop(creds) {
    return get('/shop.json', creds).data.shop;
}

/**
 * Convert decimal price string to CTP money shape.
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
    getCreds:          getCreds,
    getAccessToken:    getAccessToken,
    fetchAccessToken:  fetchAccessToken,
    isDirectToken:     isDirectToken,
    parseOAuthError:   parseOAuthError,
    adminBase:         adminBase,
    authHeaders:       authHeaders,
    get:               get,
    graphql:           graphql,
    send:              send,
    fetchAll:          fetchAll,
    fetchMerchantLocations:  fetchMerchantLocations,
    fetchInventoryLocations: fetchInventoryLocations,
    fetchPage:         fetchPage,
    parseNextPageInfo: parseNextPageInfo,
    getShop:           getShop,
    priceToMoney:      priceToMoney
};
