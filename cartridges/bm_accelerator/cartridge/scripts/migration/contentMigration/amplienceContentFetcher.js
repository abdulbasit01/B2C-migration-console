'use strict';

var http    = require('*/cartridge/scripts/migration/core/http');
var auth    = require('*/cartridge/scripts/migration/connectors/amplience/amplienceAuth');
var cdnUtil = require('*/cartridge/scripts/migration/contentMigration/amplienceCdn');

var API_BASE = 'https://api.amplience.net/v2/content';

function authHeaders(token) {
    return {
        Authorization:  'Bearer ' + token,
        'Content-Type': 'application/json'
    };
}

function findHub(hubs, hubName) {
    var target = String(hubName || '').toLowerCase();
    for (var i = 0; i < hubs.length; i++) {
        if (String(hubs[i].name || '').toLowerCase() === target) {
            return hubs[i];
        }
    }
    return null;
}

function getHub() {
    var c     = auth.resolveCreds();
    var token = auth.getAccessToken(c).token;
    var hubsRes = http.get(API_BASE + '/hubs', authHeaders(token));

    if (hubsRes.status !== 200) {
        throw new Error('Unable to list hubs (' + hubsRes.status + ')');
    }

    var hubs = (hubsRes.data._embedded && hubsRes.data._embedded.hubs) || [];
    var hub  = findHub(hubs, c.hubName);
    if (!hub) {
        throw new Error('Hub not found: ' + c.hubName);
    }

    return { token: token, hub: hub };
}

function listRepositories(token, hubId) {
    var repositories = [];
    var page = 0;
    var totalPages = 1;

    while (page < totalPages) {
        var res = http.get(
            API_BASE + '/hubs/' + encodeURIComponent(hubId)
                + '/content-repositories?page=' + page + '&size=100',
            authHeaders(token)
        );
        if (res.status !== 200) {
            throw new Error('Unable to list content repositories (' + res.status + ')');
        }
        var batch = (res.data._embedded && res.data._embedded['content-repositories']) || [];
        repositories = repositories.concat(batch);
        totalPages = res.data.page ? (res.data.page.totalPages || 1) : 1;
        page += 1;
    }
    return repositories;
}

function summarizeItem(item, repo) {
    var body        = item.body || {};
    var meta        = body._meta || {};
    var deliveryKey = meta.deliveryKey || item.deliveryKey || '';
    var schema      = meta.schema || '';
    var schemaShort = schema ? schema.split('/').pop() : '';
    var repoLabel   = (repo && (repo.label || repo.name)) || '';
    var repoName    = (repo && repo.name) || '';

    return {
        id:           item.id || '',
        label:        item.label || meta.name || deliveryKey || item.id || 'Untitled',
        deliveryKey:  deliveryKey,
        schema:       schema,
        schemaShort:  schemaShort,
        status:       item.status || '',
        locale:       item.locale || '',
        lastModified: item.lastModifiedDate || '',
        hasKey:       !!deliveryKey,
        repoName:     repoName,
        repoLabel:    repoLabel
    };
}

function listRepoItems(token, repo, limit) {
    var items = [];
    var page = 0;
    var totalPages = 1;
    var total = 0;

    while (page < totalPages) {
        var res = http.get(
            API_BASE + '/content-repositories/' + encodeURIComponent(repo.id)
                + '/content-items?page=' + page + '&size=' + limit + '&sort=lastModifiedDate,desc',
            authHeaders(token)
        );
        if (res.status !== 200) {
            throw new Error(
                'Unable to list items for ' + (repo.label || repo.name)
                    + ' (' + res.status + ')'
            );
        }
        var raw = (res.data._embedded && res.data._embedded['content-items']) || [];
        var i;
        for (i = 0; i < raw.length; i++) {
            items.push(summarizeItem(raw[i], repo));
        }
        total = res.data.page ? (res.data.page.totalElements || items.length) : items.length;
        totalPages = res.data.page ? (res.data.page.totalPages || 1) : 1;
        page += 1;
    }
    return {
        items: items,
        total: total
    };
}

/**
 * List content items from all hub repositories (Content, Slots, etc.).
 * @param {number} [pageSize] - API page size; all pages are loaded
 * @returns {Object}
 */
function listContentItems(pageSize) {
    if (!auth.hasManagementCreds(auth.resolveCreds())) {
        throw new Error('Personal Access Token required to list content. Add your PAT in Connect step.');
    }

    var limit = Math.min(Math.max(parseInt(String(pageSize || 100), 10) || 100, 1), 100);
    var ctx   = getHub();
    var repos = listRepositories(ctx.token, ctx.hub.id);

    if (!repos.length) {
        return { total: 0, items: [], hubName: ctx.hub.name, repositories: [], schemas: [] };
    }

    var items = [];
    var repoSummaries = [];
    var schemaMap = {};
    var r;
    for (r = 0; r < repos.length; r++) {
        var repo = repos[r];
        var listed = listRepoItems(ctx.token, repo, limit);
        repoSummaries.push({
            id:    repo.id,
            name:  repo.name || '',
            label: repo.label || repo.name || repo.id,
            count: listed.total
        });
        var i;
        for (i = 0; i < listed.items.length; i++) {
            var item = listed.items[i];
            items.push(item);
            if (item.schemaShort) schemaMap[item.schemaShort] = true;
        }
    }

    var schemas = Object.keys(schemaMap).sort();

    return {
        total:        items.length,
        items:        items,
        hubName:      ctx.hub.name,
        repositories: repoSummaries,
        schemas:      schemas
    };
}

function fetchFromCdn(hubName, deliveryKey) {
    var url = cdnUtil.buildCdnUrl(hubName, deliveryKey);
    var res = http.get(url, { 'Content-Type': 'application/json' });
    return { status: res.status, data: res.data, url: url };
}

/**
 * Unwrap Amplience CDN / management payloads to the content body.
 * @param {Object} data
 * @returns {Object}
 */
function unwrapContent(data) {
    if (!data || typeof data !== 'object') return {};
    if (data.content && typeof data.content === 'object') return data.content;
    return data;
}

/**
 * Fetch published content from the CDN by delivery key.
 * @param {string} deliveryKey
 * @returns {Object}
 */
function fetchByDeliveryKey(deliveryKey) {
    var c   = auth.resolveCreds();
    var key = String(deliveryKey || c.defaultDeliveryKey || '').trim();

    if (!key) {
        throw new Error('Delivery key is required.');
    }
    if (!c.hubName) {
        throw new Error('Amplience hub name is not configured.');
    }

    var cdnResult = fetchFromCdn(c.hubName, key);
    if (cdnResult.status === 200) {
        return {
            deliveryKey:     key,
            contentId:       '',
            hasDeliveryKey:  true,
            hubName:         c.hubName,
            content:         unwrapContent(cdnResult.data),
            cdnUrl:          cdnResult.url.split('?')[0],
            source:          'cdn'
        };
    }

    // UUID-looking values are usually Amplience content IDs, not delivery keys.
    if (cdnResult.status === 404 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
        return fetchByContentId(key);
    }

    var hint = 'Ensure the item is published and the delivery key is correct.';
    if (key.indexOf('/') >= 0) {
        hint += ' Path-style keys such as page/jackets must match exactly (case-sensitive).';
    }
    if (cdnResult.status === 404) {
        throw new Error('Content not found on CDN (404): ' + key + '. ' + hint);
    }
    throw new Error('CDN fetch failed (' + cdnResult.status + '): ' + key + '. ' + hint);
}

/**
 * Fetch content item body via Management API (works without a delivery key).
 * @param {string} contentId
 * @returns {Object}
 */
function fetchByContentIdWithContext(contentId, ctx, creds) {
    var id = String(contentId || '').trim();
    if (!id) {
        throw new Error('Content item id is required.');
    }
    var res = http.get(
        API_BASE + '/content-items/' + encodeURIComponent(id),
        authHeaders(ctx.token)
    );

    if (res.status !== 200) {
        throw new Error('Unable to fetch content item (' + res.status + '): ' + id);
    }

    var item = res.data || {};
    var body = unwrapContent(item.body || item);
    var meta = (body && body._meta) || {};
    var key  = meta.deliveryKey || item.deliveryKey || '';

    return {
        deliveryKey:    key,
        contentId:      id,
        hasDeliveryKey: !!key,
        hubName:        creds.hubName || (ctx.hub && ctx.hub.name) || '',
        content:        body,
        rawItem:        item,
        label:          item.label || meta.name || key || id,
        status:         item.status || '',
        locale:         item.locale || '',
        lastModified:   item.lastModifiedDate || '',
        source:         'management'
    };
}

function fetchByContentId(contentId) {
    var creds = auth.resolveCreds();
    if (!auth.hasManagementCreds(creds)) {
        throw new Error('Personal Access Token required to fetch content by id.');
    }
    return fetchByContentIdWithContext(contentId, getHub(), creds);
}

/**
 * Fetch many content items while reusing one hub/auth lookup.
 * @param {string[]} contentIds
 * @returns {{ items: Object[], errors: Object[] }}
 */
function fetchByContentIds(contentIds) {
    var creds = auth.resolveCreds();
    if (!auth.hasManagementCreds(creds)) {
        throw new Error('Personal Access Token required to fetch content by id.');
    }
    var ctx = getHub();
    var items = [];
    var errors = [];
    var i;
    for (i = 0; i < (contentIds || []).length; i++) {
        var id = String(contentIds[i] || '').trim();
        if (!id) continue;
        try {
            items.push(fetchByContentIdWithContext(id, ctx, creds));
        } catch (e) {
            errors.push({ contentId: id, error: e.message || String(e) });
        }
    }
    return { items: items, errors: errors };
}

module.exports = {
    listContentItems:   listContentItems,
    fetchByDeliveryKey: fetchByDeliveryKey,
    fetchByContentId:   fetchByContentId,
    fetchByContentIds:  fetchByContentIds
};
