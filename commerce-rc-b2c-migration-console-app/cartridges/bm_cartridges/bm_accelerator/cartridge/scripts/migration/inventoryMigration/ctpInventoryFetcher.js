'use strict';

var http     = require('*/cartridge/scripts/migration/core/http');
var cfg      = require('*/cartridge/scripts/migration/configAccessor');
var Encoding = require('dw/crypto/Encoding');
var Bytes    = require('dw/util/Bytes');
// Same SKU → SFCC product rule as the order migration ({master}-{n}, bundles and single products by ID)
var productIds = require('*/cartridge/scripts/migration/orders/productIdResolver');

// One GraphQL request per 100 SKUs; the reply holds only IDs and SKUs (~34K chars measured)
var SKU_LOOKUP_CHUNK = 100;
var PRODUCT_QUERY = 'query ($where: String!) { products(where: $where, limit: 500) { results { id key '
    + 'masterData { current { masterVariant { id sku } variants { id sku } } '
    + 'staged { masterVariant { id sku } variants { id sku } } } } } }';

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function getToken() {
    var c    = cfg.ctp;
    var body = 'grant_type=client_credentials';
    if (c.scopes) body += '&scope=' + encodeURIComponent(c.scopes);

    var res = http.post(
        c.authUrl + '/oauth/token',
        {
            Authorization:  'Basic ' + toBase64(c.clientId + ':' + c.clientSecret),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    );
    if (res.status !== 200 || !res.data.access_token) {
        throw new Error('CT auth failed (' + res.status + ')');
    }
    return res.data.access_token;
}

function normalizeChannelId(supplyChannelId) {
    if (!supplyChannelId || supplyChannelId === 'all') return '';
    return String(supplyChannelId);
}

/**
 * @param {string} [supplyChannelId]
 * @returns {string}
 */
function buildWhereClause(supplyChannelId) {
    var channelId = normalizeChannelId(supplyChannelId);
    if (!channelId) return '';
    return 'supplyChannel(id="' + channelId.replace(/"/g, '\\"') + '")';
}

/**
 * @param {string} [supplyChannelId]
 * @returns {string}
 */
function inventoryBaseQs(supplyChannelId) {
    var where = buildWhereClause(supplyChannelId);
    return where ? ('?where=' + encodeURIComponent(where)) : '?';
}

/**
 * Return total inventory entries in CT (optionally filtered by supply channel).
 * @param {string} [supplyChannelId]
 * @returns {number}
 */
function getCount(supplyChannelId) {
    var c     = cfg.ctp;
    var token = getToken();
    var qs    = inventoryBaseQs(supplyChannelId);
    if (qs === '?') {
        qs += 'limit=1';
    } else {
        qs += '&limit=1';
    }

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/inventory' + qs,
        { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT inventory count failed (' + res.status + ')');
    }
    return res.data.total || 0;
}

/**
 * Fetch one page of inventory entries from CT.
 * @param {number} offset
 * @param {number} limit
 * @param {string} [supplyChannelId]
 * @param {string} [sortField] - CT sort field, e.g. id or sku
 * @returns {{ results: Array, total: number }}
 */
function fetchBatch(offset, limit, supplyChannelId, sortField) {
    var c   = cfg.ctp;
    var tok = getToken();
    var qs  = inventoryBaseQs(supplyChannelId);
    var sort = sortField || 'id';
    if (qs === '?') {
        qs += 'limit=' + (limit || 500) + '&offset=' + (offset || 0)
            + '&sort=' + encodeURIComponent(sort + ' asc') + '&withTotal=true';
    } else {
        qs += '&limit=' + (limit || 500) + '&offset=' + (offset || 0)
            + '&sort=' + encodeURIComponent(sort + ' asc') + '&withTotal=true';
    }

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/inventory' + qs,
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT inventory fetch failed (' + res.status + ')');
    }
    var results = res.data.results || [];
    addSfccProductIds(tok, results);
    return {
        results: results,
        total:   res.data.total   || 0
    };
}

/**
 * Product and variant of each SKU in commercetools (published data first, then staged).
 * @param {string} token
 * @param {string[]} skus - SKUs exactly as on the inventory entries
 * @returns {Object} sku → { productId, key, variantId }
 */
function lookupSkus(token, skus) {
    var c    = cfg.ctp;
    var info = {};
    var i;
    for (i = 0; i < skus.length; i += SKU_LOOKUP_CHUNK) {
        var list = skus.slice(i, i + SKU_LOOKUP_CHUNK).map(function (s) {
            return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        }).join(', ');
        var variantMatch = 'masterVariant(sku in (' + list + ')) or variants(sku in (' + list + '))';
        var where = 'masterData(current(' + variantMatch + ') or staged(' + variantMatch + '))';
        var res = http.post(
            c.apiUrl + '/' + c.projectKey + '/graphql',
            { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            JSON.stringify({ query: PRODUCT_QUERY, variables: { where: where } })
        );
        var errors = res.data && res.data.errors;
        if (res.status !== 200 || (errors && errors.length)) {
            throw new Error('CT product lookup for inventory SKUs failed (' + res.status + ')'
                + (errors && errors.length ? ': ' + errors[0].message : ''));
        }
        var products = (res.data.data && res.data.data.products && res.data.data.products.results) || [];
        products.forEach(function (p) {
            ['current', 'staged'].forEach(function (view) {
                var data = p.masterData && p.masterData[view];
                if (!data) return;
                [data.masterVariant].concat(data.variants || []).forEach(function (v) {
                    if (v && v.sku && !info[v.sku]) {
                        info[v.sku] = {
                            productId:     p.id,
                            key:           p.key || '',
                            variantId:     v.id,
                            masterVariant: v === data.masterVariant
                        };
                    }
                });
            });
        });
    }
    return info;
}

/**
 * Set entry.sfccProductId to the SFCC product of the entry's SKU (inventory.xsd product-id):
 * the commercetools SKU is not an SFCC product ID. '' when no SFCC product matches.
 * @param {string} token
 * @param {Object[]} entries - commercetools inventory entries (changed in place)
 */
function addSfccProductIds(token, entries) {
    var skus = [];
    var seen = {};
    entries.forEach(function (e) {
        if (e && e.sku && !seen[e.sku]) {
            seen[e.sku] = true;
            skus.push(e.sku);
        }
    });
    if (!skus.length) return;

    var info     = lookupSkus(token, skus);
    var resolver = productIds.createResolver();
    entries.forEach(function (e) {
        if (!e || !e.sku) return;
        var hit = info[e.sku];
        var li  = {
            sku:              e.sku,
            sourceProductId:  hit ? hit.productId : '',
            sourceProductKey: hit ? hit.key : '',
            sourceVariantId:  hit ? hit.variantId : null
        };
        if (hit) resolver.resolveOrder({ lineItems: [li] });
        var id = li.productId || '';
        // A bundle or set is one SFCC product (no variant products): only its master variant's
        // stock belongs to it, as for its price; other variant SKUs have no SFCC product.
        if (id && !hit.masterVariant && (id === hit.productId || id === hit.key)) id = '';
        e.sfccProductId = id;
    });
}

/**
 * Fetch inventory supply channels from CT.
 * Falls back to all channels when none match InventorySupply filter.
 * @returns {Array<{id: string, key: string, name: string}>}
 */
function fetchSupplyChannels() {
    var c     = cfg.ctp;
    var token = getToken();

    function fetchWithWhere(whereClause) {
        var qs = whereClause
            ? ('?where=' + encodeURIComponent(whereClause) + '&limit=500')
            : '?limit=500';

        var res = http.get(
            c.apiUrl + '/' + c.projectKey + '/channels' + qs,
            { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
        );
        if (res.status !== 200) {
            throw new Error('CT supply channels fetch failed (' + res.status + ')');
        }
        return (res.data && res.data.results) ? res.data.results : [];
    }

    var rows = fetchWithWhere('roles contains any ("InventorySupply")');
    if (!rows.length) {
        rows = fetchWithWhere('');
    }

    var results = [];
    var i;
    for (i = 0; i < rows.length; i++) {
        var ch = rows[i];
        var roles = ch.roles || [];
        if (roles.length && roles.indexOf('InventorySupply') < 0) {
            continue;
        }
        var name = ch.name;
        if (name && typeof name === 'object') {
            name = name.en || name['en-US'] || name.default || ch.key || ch.id;
        }
        results.push({
            id:   ch.id,
            key:  ch.key || ch.id,
            name: name || ch.key || ch.id
        });
    }
    return results;
}

module.exports = {
    getCount:             getCount,
    fetchBatch:           fetchBatch,
    fetchSupplyChannels:  fetchSupplyChannels
};
