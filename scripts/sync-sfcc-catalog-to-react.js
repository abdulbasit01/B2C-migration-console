#!/usr/bin/env node
'use strict';

/**
 * Sync migrated Amplience components from SFCC storefront List API
 * into react-storefront/public/amplience-catalog.json
 *
 * Usage: npm run sync:sfcc-catalog
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var OUT = path.join(ROOT, 'react-storefront/public/amplience-catalog.json');
var STALE_MS = 15 * 60 * 1000;
var FORCE_SYNC = process.argv.indexOf('--force') >= 0;
var PROBE_CDN = process.argv.indexOf('--probe-cdn') >= 0;

function isCatalogFresh() {
    if (!fs.existsSync(OUT)) return false;
    var stat = fs.statSync(OUT);
    return (Date.now() - stat.mtimeMs) < STALE_MS;
}

function sleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function readEnvFile() {
    var envPath = path.join(ROOT, '.env');
    var env = {};
    if (!fs.existsSync(envPath)) return env;
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(function (line) {
        var trimmed = line.trim();
        if (!trimmed || trimmed.charAt(0) === '#') return;
        var idx = trimmed.indexOf('=');
        if (idx < 0) return;
        env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    });
    return env;
}

function resolveStorefrontBase(env) {
    var explicit = env.VITE_SFCC_STOREFRONT_URL || env.SFCC_STOREFRONT_URL || '';
    if (explicit) return explicit.replace(/\/$/, '');

    var dwPath = path.join(ROOT, 'dw.json');
    if (!fs.existsSync(dwPath)) return '';

    var dw = JSON.parse(fs.readFileSync(dwPath, 'utf8'));
    var hostname = String(dw.hostname || '').trim();
    if (!hostname) return '';

    var siteId = env.SFCC_SITE_ID || env.VITE_SFCC_SITE_ID || 'MigrationConsole';
    var locale = env.SFCC_LOCALE || env.VITE_SFCC_LOCALE || 'en_US';
    return 'https://' + hostname
        + '/on/demandware.store/Sites-' + siteId + '-Site/' + locale;
}

async function fetchCatalogPage(baseUrl, page, pageSize) {
    var url = baseUrl + '/AmplienceContent-List?page=' + page + '&pageSize=' + pageSize;
    var res = await fetch(url, {
        headers: { Accept: 'application/json' }
    });
    if (!res.ok) {
        throw new Error('SFCC catalog request failed (' + res.status + ') for ' + url);
    }
    var payload = await res.json();
    if (!payload || !payload.ok) {
        throw new Error((payload && payload.error) || 'SFCC catalog response was not ok');
    }
    return payload;
}

async function probeCdnPublished(hubName, contentId, deliveryKey) {
    var hub = String(hubName || '').trim();
    if (!hub) return false;

    var key = String(deliveryKey || '').trim();
    var id = String(contentId || '').trim();
    if (key) {
        var keyUrl = 'https://' + hub + '.cdn.content.amplience.net/content/key/'
            + key.split('/').map(encodeURIComponent).join('/');
        var keyRes = await fetch(keyUrl, { method: 'HEAD' });
        if (keyRes.ok) return true;
    }
    if (id) {
        var idUrl = 'https://' + hub + '.cdn.content.amplience.net/content/id/'
            + encodeURIComponent(id);
        var idRes = await fetch(idUrl, { method: 'HEAD' });
        return idRes.ok;
    }
    return false;
}

async function annotateCdnStatus(hubName, items) {
    var concurrency = 2;
    var delayMs = 150;
    var index = 0;
    var publishedCount = 0;

    async function worker() {
        while (index < items.length) {
            var current = index;
            index += 1;
            var item = items[current];
            var published = await probeCdnPublished(hubName, item.contentId, item.deliveryKey);
            item.publishedOnCdn = published;
            if (published) publishedCount += 1;
            await sleep(delayMs);
        }
    }

    var workers = [];
    var w;
    for (w = 0; w < concurrency; w += 1) {
        workers.push(worker());
    }
    await Promise.all(workers);
    console.log('CDN published:', publishedCount + '/' + items.length);
    return items;
}

async function main() {
    if (!FORCE_SYNC && !PROBE_CDN && isCatalogFresh()) {
        console.log('Catalog is fresh (<15 min). Skipping sync. Use --force to refresh.');
        return;
    }

    var env = readEnvFile();
    var baseUrl = resolveStorefrontBase(env);

    if (baseUrl) {
        try {
            await syncFromSfcc(baseUrl, env);
            return;
        } catch (err) {
            console.warn('SFCC catalog sync failed:', err.message || err);
            if (fs.existsSync(OUT)) {
                console.warn('Keeping existing amplience-catalog.json');
                return;
            }
            console.warn('Falling back to Amplience Management API export...');
        }
    }

    await exportFromAmplience(env);
}

async function syncFromSfcc(baseUrl, env) {
    var page = 1;
    var pageSize = 48;
    var allItems = [];
    var lastPayload = null;

    while (page < 100) {
        var payload = await fetchCatalogPage(baseUrl, page, pageSize);
        lastPayload = payload;
        allItems = allItems.concat(payload.items || []);
        if (!payload.hasNext) break;
        page += 1;
        await sleep(200);
    }

    if (PROBE_CDN) {
        var hubName = env.AMPLIENCE_HUB_NAME || env.VITE_AMPLIENCE_HUB_NAME || '';
        if (!hubName) {
            console.warn('AMPLIENCE_HUB_NAME missing; skipping CDN probe.');
        } else {
            console.log('Probing CDN publish status for', allItems.length, 'SFCC items…');
            await annotateCdnStatus(hubName, allItems);
        }
    }

    writeCatalog({
        source: 'sfcc',
        storefrontUrl: baseUrl,
        hubName: env.AMPLIENCE_HUB_NAME || env.VITE_AMPLIENCE_HUB_NAME || '',
        total: lastPayload ? lastPayload.total : allItems.length,
        items: allItems
    });
    console.log('Synced', allItems.length, 'SFCC components to', OUT);
}

function inferWidgetType(schema, schemaShort) {
    var s = String(schema || schemaShort || '').toLowerCase();
    if (s.indexOf('rich-text') >= 0 || s.indexOf('rich') >= 0 || s.indexOf('editorial') >= 0) {
        return 'editorialRichText';
    }
    if (s.indexOf('banner') >= 0 || s.indexOf('hero') >= 0) return 'mainBanner';
    if (s.indexOf('campaign') >= 0) return 'campaignBanner';
    if (s.indexOf('image') >= 0 && s.indexOf('text') >= 0) return 'imageAndText';
    return 'amplienceWidget';
}

function widgetLabel(widgetType, schemaShort) {
    var labels = {
        mainBanner: 'Main Banner',
        campaignBanner: 'Campaign Banner',
        editorialRichText: 'Editorial Rich Text',
        imageAndText: 'Image and Text',
        amplienceWidget: schemaShort || 'Amplience Widget'
    };
    return labels[widgetType] || widgetType;
}

async function apiGet(url, token) {
    var res = await fetch(url, {
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
        }
    });
    if (!res.ok) {
        throw new Error('Amplience API ' + res.status + ' for ' + url);
    }
    return res.json();
}

async function exportFromAmplience(env) {
    var hubName = env.AMPLIENCE_HUB_NAME || env.VITE_AMPLIENCE_HUB_NAME || '';
    var token = env.AMPLIENCE_PERSONAL_ACCESS_TOKEN || '';
    if (!hubName || !token) {
        throw new Error('AMPLIENCE_HUB_NAME and AMPLIENCE_PERSONAL_ACCESS_TOKEN required for fallback export');
    }

    var hubs = await apiGet(API_BASE + '/hubs', token);
    var hubList = (hubs._embedded && hubs._embedded.hubs) || [];
    var hub = hubList.find(function (entry) {
        return String(entry.name || '').toLowerCase() === hubName.toLowerCase();
    });
    if (!hub) throw new Error('Hub not found: ' + hubName);

    var repos = [];
    var repoPage = 0;
    var repoPages = 1;
    while (repoPage < repoPages) {
        var repoData = await apiGet(
            API_BASE + '/hubs/' + encodeURIComponent(hub.id)
                + '/content-repositories?page=' + repoPage + '&size=100',
            token
        );
        repos = repos.concat((repoData._embedded && repoData._embedded['content-repositories']) || []);
        repoPages = repoData.page ? (repoData.page.totalPages || 1) : 1;
        repoPage += 1;
    }

    var items = [];
    var r;
    for (r = 0; r < repos.length; r++) {
        var repo = repos[r];
        var page = 0;
        var totalPages = 1;
        while (page < totalPages) {
            var listData = await apiGet(
                API_BASE + '/content-repositories/' + encodeURIComponent(repo.id)
                    + '/content-items?page=' + page + '&size=100&sort=lastModifiedDate,desc',
                token
            );
            var batch = (listData._embedded && listData._embedded['content-items']) || [];
            var i;
            for (i = 0; i < batch.length; i++) {
                var item = batch[i];
                var body = item.body || {};
                var meta = body._meta || {};
                var schema = meta.schema || '';
                var schemaShort = schema ? schema.split('/').pop() : '';
                var widgetType = inferWidgetType(schema, schemaShort);
                var contentId = String(item.id || '');
                items.push({
                    id: 'amp-' + contentId,
                    name: item.label || meta.name || meta.deliveryKey || contentId,
                    description: '',
                    widgetType: widgetType,
                    widgetLabel: widgetLabel(widgetType, schemaShort),
                    contentId: contentId,
                    deliveryKey: meta.deliveryKey || item.deliveryKey || '',
                    imageUrl: '',
                    status: item.status || '',
                    schema: schema
                });
            }
            totalPages = listData.page ? (listData.page.totalPages || 1) : 1;
            page += 1;
        }
    }

    items.sort(function (a, b) {
        return String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
    });

    writeCatalog({
        source: 'amplience',
        hubName: hubName,
        total: items.length,
        items: items
    });
    console.log('Exported', items.length, 'Amplience components to', OUT);
}

function writeCatalog(payload) {
    var output = {
        ok: true,
        source: payload.source,
        hubName: payload.hubName || '',
        storefrontUrl: payload.storefrontUrl || '',
        total: payload.total,
        exportedAt: new Date().toISOString(),
        items: payload.items
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(output, null, 2), 'utf8');
}

var API_BASE = 'https://api.amplience.net/v2/content';

main().catch(function (err) {
    console.error(err.message || err);
    process.exit(1);
});
