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
    var res = http.get(
        API_BASE + '/hubs/' + encodeURIComponent(hubId) + '/content-repositories',
        authHeaders(token)
    );
    if (res.status !== 200) {
        throw new Error('Unable to list content repositories (' + res.status + ')');
    }
    return (res.data._embedded && res.data._embedded['content-repositories']) || [];
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
    var res = http.get(
        API_BASE + '/content-repositories/' + encodeURIComponent(repo.id)
            + '/content-items?page=0&size=' + limit + '&sort=lastModifiedDate,desc',
        authHeaders(token)
    );
    if (res.status !== 200) {
        return { items: [], total: 0, error: 'Unable to list items for ' + (repo.label || repo.name) };
    }
    var raw   = (res.data._embedded && res.data._embedded['content-items']) || [];
    var items = [];
    var i;
    for (i = 0; i < raw.length; i++) {
        items.push(summarizeItem(raw[i], repo));
    }
    return {
        items: items,
        total: res.data.page ? (res.data.page.totalElements || items.length) : items.length
    };
}

/**
 * List content items from all hub repositories (Content, Slots, etc.).
 * @param {number} [pageSize] - max items per repository
 * @returns {Object}
 */
function listContentItems(pageSize) {
    if (!auth.hasManagementCreds(auth.resolveCreds())) {
        throw new Error('Personal Access Token required to list content. Add your PAT in Connect step.');
    }

    var limit = Math.min(Math.max(parseInt(String(pageSize || 50), 10) || 50, 1), 100);
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
function fetchByContentId(contentId) {
    var id = String(contentId || '').trim();
    if (!id) {
        throw new Error('Content item id is required.');
    }
    if (!auth.hasManagementCreds(auth.resolveCreds())) {
        throw new Error('Personal Access Token required to fetch content by id.');
    }

    var c   = auth.resolveCreds();
    var ctx = getHub();
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
        hubName:        c.hubName || (ctx.hub && ctx.hub.name) || '',
        content:        body,
        label:          item.label || meta.name || key || id,
        source:         'management'
    };
}

module.exports = {
    listContentItems:   listContentItems,
    fetchByDeliveryKey: fetchByDeliveryKey,
    fetchByContentId:   fetchByContentId
};
