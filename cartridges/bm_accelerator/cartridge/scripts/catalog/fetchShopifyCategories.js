'use strict';

var http         = require('*/cartridge/scripts/migration/core/http');
var connector    = require('~/cartridge/scripts/migration/connectors/shopify/shopifyConnector');
var cfg          = require('*/cartridge/scripts/migration/configAccessor');
var taxonomyData = require('~/cartridge/scripts/catalog/shopifyTaxonomyData');
var Logger       = require('dw/system/Logger');

var API_BATCH = 250;
var PAGE_SIZE = 50;

/*
 * Cursor prefixes:
 *  "__l1d__:ap,aa,..."     → fetch descendants of first code, advance list
 *  "__l1c__:ap:CURSOR:aa"  → continue paging descendants of "ap"
 *  "1","2",…               → static taxonomy slice (fallback)
 */
var L1D = '__l1d__:';
var L1C = '__l1c__:';

/* ─── helpers ──────────────────────────────────────────────────────────────── */

function toSlug(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function hasSubcategories(nodes) {
    for (var i = 0; i < nodes.length; i++) {
        if (String(nodes[i].fullName || '').indexOf(' > ') > -1) return true;
        if ((nodes[i].level || 1) > 1) return true;
    }
    return false;
}

function transformAPINodes(apiNodes) {
    return apiNodes.map(function (c) {
        var fullName = String(c.fullName || c.name || '');
        var name     = String(c.name || '');
        var lastSep  = fullName.lastIndexOf(' > ');
        var parentFn = lastSep > -1 ? fullName.substring(0, lastSep) : '';
        return {
            id      : toSlug(fullName),
            name    : name,
            parentId: parentFn ? toSlug(parentFn) : ''
        };
    });
}

/* ─── API fetch ─────────────────────────────────────────────────────────────── */

function fetchRootPage(base, hdrs, cursor) {
    var after = cursor ? '(first:' + API_BATCH + ',after:"' + cursor + '")' : '(first:' + API_BATCH + ')';
    var query = '{ taxonomy { categories' + after
        + ' { nodes { id name fullName level isLeaf } pageInfo { hasNextPage endCursor } } } }';
    var res = http.post(base + '/graphql.json', hdrs, JSON.stringify({ query: query }));
    if (res.status !== 200) return { nodes: [], hasNextPage: false, endCursor: '' };
    var data     = res.data || {};
    var cats     = (data.data && data.data.taxonomy && data.data.taxonomy.categories) || {};
    var pageInfo = cats.pageInfo || {};
    return { nodes: cats.nodes || [], hasNextPage: !!pageInfo.hasNextPage, endCursor: pageInfo.endCursor || '' };
}

function fetchDescendants(base, hdrs, l1Code, cursor) {
    var after  = cursor ? ',after:"' + cursor + '"' : '';
    var query  = '{ taxonomy { categories(first:' + API_BATCH
        + ',query:"ancestor_id:' + l1Code + '"' + after + ')'
        + ' { nodes { id name fullName level isLeaf } pageInfo { hasNextPage endCursor } } } }';
    var res = http.post(base + '/graphql.json', hdrs, JSON.stringify({ query: query }));
    if (res.status !== 200) {
        Logger.warn('fetchShopifyCategories: fetchDescendants status={0} code={1}', res.status, l1Code);
        return { nodes: [], hasNextPage: false, endCursor: '' };
    }
    var data     = res.data || {};
    if (data.errors && data.errors.length) {
        Logger.warn('fetchShopifyCategories: fetchDescendants errors code={0}: {1}', l1Code, JSON.stringify(data.errors));
        return { nodes: [], hasNextPage: false, endCursor: '' };
    }
    var cats     = (data.data && data.data.taxonomy && data.data.taxonomy.categories) || {};
    var pageInfo = cats.pageInfo || {};
    var nodes    = cats.nodes || [];
    Logger.info('fetchShopifyCategories: descendants code={0} nodes={1} hasMore={2}', l1Code, nodes.length, !!pageInfo.hasNextPage);
    return { nodes: nodes, hasNextPage: !!pageInfo.hasNextPage, endCursor: pageInfo.endCursor || '' };
}

var MAX_CALLS = 14;

function fetchAllAPINodes(base, hdrs) {
    var callsUsed = 0;
    var all  = [];
    var cur  = null;
    var more = true;
    while (more && callsUsed < MAX_CALLS) {
        var p = fetchRootPage(base, hdrs, cur);
        callsUsed++;
        all   = all.concat(p.nodes);
        more  = p.hasNextPage;
        cur   = p.endCursor || null;
    }
    if (all.length === 0) return [];
    if (hasSubcategories(all)) {
        Logger.info('fetchAllAPINodes: multi-level, {0} nodes, {1} calls used', all.length, callsUsed);
        return all;
    }
    Logger.info('fetchAllAPINodes: L1-only ({0}), fetching descendants', all.length);
    var l1Nodes = all.slice();
    for (var i = 0; i < l1Nodes.length && callsUsed < MAX_CALLS; i++) {
        var code    = String(l1Nodes[i].id || '').split('/').pop();
        if (!code) continue;
        var dcursor = null;
        var dmore   = true;
        while (dmore && callsUsed < MAX_CALLS) {
            var dp  = fetchDescendants(base, hdrs, code, dcursor);
            callsUsed++;
            all     = all.concat(dp.nodes);
            dmore   = dp.hasNextPage;
            dcursor = dp.endCursor || null;
        }
    }
    if (callsUsed >= MAX_CALLS) {
        Logger.warn('fetchAllAPINodes: hit {0}-call limit', MAX_CALLS);
    }
    Logger.info('fetchAllAPINodes: total={0}, calls={1}', all.length, callsUsed);
    return all;
}

/* ─── static taxonomy fallback ──────────────────────────────────────────────── */

function staticPage(pageNum) {
    var data  = taxonomyData.TAXONOMY;
    var start = pageNum * PAGE_SIZE;
    var end   = Math.min(start + PAGE_SIZE, data.length);
    var isLast = end >= data.length;
    var slice  = data.slice(start, end);
    if (isLast) {
        var extras = [];
        try { extras = JSON.parse(String(session.custom.shopifyCatExtras || '[]')); } catch (e) {}
        slice = slice.concat(extras);
    }
    return { results: slice, nextCursor: isLast ? '' : String(pageNum + 1), done: isLast };
}

/* ─── main export ───────────────────────────────────────────────────────────── */

function fetchCollectionsPage(offsetStr) {
    var creds = cfg.shopify || {};
    if (!creds.storeUrl) {
        Logger.warn('fetchShopifyCategories: storeUrl not configured, using static taxonomy');
        return staticPage(0);
    }
    var base  = connector.getAdminBase(creds);
    var hdrs  = connector.getAuthHeaders(creds);
    var raw   = String(offsetStr || '0');

    /* ── Continue paging current L1's descendants ────────────────────────────── */
    if (raw.indexOf(L1C) === 0) {
        var rest  = raw.substring(L1C.length);
        var c1    = rest.indexOf(':');
        var c2    = rest.indexOf(':', c1 + 1);
        var code  = rest.substring(0, c1);
        var cur   = rest.substring(c1 + 1, c2);
        var rem   = rest.substring(c2 + 1);

        var dp      = fetchDescendants(base, hdrs, code, cur || null);
        var results = transformAPINodes(dp.nodes);
        if (dp.hasNextPage) {
            return { results: results, nextCursor: L1C + code + ':' + dp.endCursor + ':' + rem, done: false };
        }
        if (!rem) return { results: results, nextCursor: '', done: true };
        return { results: results, nextCursor: L1D + rem, done: false };
    }

    /* ── Start fetching descendants of next L1 in list ───────────────────────── */
    if (raw.indexOf(L1D) === 0) {
        var list    = raw.substring(L1D.length);
        var comma   = list.indexOf(',');
        var code2   = comma > -1 ? list.substring(0, comma) : list;
        var rem2    = comma > -1 ? list.substring(comma + 1) : '';

        var dp2      = fetchDescendants(base, hdrs, code2, null);
        var results2 = transformAPINodes(dp2.nodes);
        Logger.info('fetchShopifyCategories: L1D code={0} got={1} hasMore={2} rem={3}',
            code2, results2.length, dp2.hasNextPage, rem2 ? rem2.split(',').length : 0);

        if (dp2.hasNextPage) {
            return { results: results2, nextCursor: L1C + code2 + ':' + dp2.endCursor + ':' + rem2, done: false };
        }
        if (!rem2) return { results: results2, nextCursor: '', done: true };
        return { results: results2, nextCursor: L1D + rem2, done: false };
    }

    /* ── Numeric page (static taxonomy) ─────────────────────────────────────── */
    var pageNum = parseInt(raw, 10);
    if (isNaN(pageNum) || pageNum < 0) pageNum = 0;
    if (pageNum > 0) return staticPage(pageNum);

    /* ── Page 0: probe API ───────────────────────────────────────────────────── */
    var firstPage = fetchRootPage(base, hdrs, null);
    var rootNodes = firstPage.nodes;
    Logger.info('fetchShopifyCategories: page0 nodes={0} hasNextPage={1} hasSubcats={2}',
        rootNodes.length, firstPage.hasNextPage, hasSubcategories(rootNodes));

    if (rootNodes.length > 0) {
        var batch = transformAPINodes(rootNodes);

        if (firstPage.hasNextPage) {
            return { results: batch, nextCursor: '__api__:' + firstPage.endCursor, done: false };
        }

        if (hasSubcategories(rootNodes)) {
            return { results: batch, nextCursor: '', done: true };
        }

        /* Single page, L1-only: fall back to static taxonomy */
        var staticIds2 = {};
        for (var s2 = 0; s2 < taxonomyData.TAXONOMY.length; s2++) {
            staticIds2[taxonomyData.TAXONOMY[s2].id] = true;
        }
        var apiExtras = [];
        for (var i = 0; i < rootNodes.length; i++) {
            var slug = toSlug(String(rootNodes[i].name || ''));
            if (slug && !staticIds2[slug]) {
                apiExtras.push({ id: slug, name: String(rootNodes[i].name || ''), parentId: '' });
            }
        }
        try { session.custom.shopifyCatExtras = JSON.stringify(apiExtras); } catch (e) {}
        Logger.info('fetchShopifyCategories: L1-only single page, static fallback + {0} extras', apiExtras.length);
        return staticPage(0);
    }

    /* API unreachable */
    Logger.info('fetchShopifyCategories: API returned no nodes, using static taxonomy');
    try { session.custom.shopifyCatExtras = '[]'; } catch (e) {}
    return staticPage(0);
}

/* handle __api__: continuation */
var _orig = fetchCollectionsPage;
fetchCollectionsPage = function (offsetStr) {
    var raw = String(offsetStr || '0');
    if (raw.indexOf('__api__:') === 0) {
        var creds = cfg.shopify || {};
        if (!creds.storeUrl) { return staticPage(0); }
        var base  = connector.getAdminBase(creds);
        var hdrs  = connector.getAuthHeaders(creds);
        var cur   = raw.substring('__api__:'.length);
        var p     = fetchRootPage(base, hdrs, cur);
        var res   = transformAPINodes(p.nodes);
        if (p.hasNextPage) return { results: res, nextCursor: '__api__:' + p.endCursor, done: false };
        return { results: res, nextCursor: '', done: true };
    }
    return _orig(offsetStr);
};

module.exports = {
    fetchCollectionsPage: fetchCollectionsPage,
    fetchAllAPINodes    : fetchAllAPINodes,
    hasSubcategories    : hasSubcategories,
    transformAPINodes   : transformAPINodes
};
