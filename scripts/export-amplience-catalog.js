#!/usr/bin/env node
'use strict';

/**
 * Export Amplience hub content items for the React component gallery.
 * Writes react-storefront/public/amplience-catalog.json
 *
 * Usage: npm run export:amplience-catalog
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var OUT = path.join(ROOT, 'react-storefront/public/amplience-catalog.json');
var API_BASE = 'https://api.amplience.net/v2/content';

function readEnv() {
    var envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) {
        throw new Error('.env not found in repo root');
    }
    var env = {};
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(function (line) {
        var trimmed = line.trim();
        if (!trimmed || trimmed.charAt(0) === '#') return;
        var idx = trimmed.indexOf('=');
        if (idx < 0) return;
        env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    });
    return env;
}

function inferWidgetType(schema, schemaShort) {
    var s = String(schema || schemaShort || '').toLowerCase();
    if (s.indexOf('rich-text') >= 0 || s.indexOf('rich') >= 0 || s.indexOf('editorial') >= 0) {
        return 'editorialRichText';
    }
    if (s.indexOf('banner') >= 0 || s.indexOf('hero') >= 0) {
        return 'mainBanner';
    }
    if (s.indexOf('campaign') >= 0) {
        return 'campaignBanner';
    }
    if (s.indexOf('image') >= 0 && s.indexOf('text') >= 0) {
        return 'imageAndText';
    }
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

async function probeCdnPublished(hubName, contentId, deliveryKey) {
    var key = String(deliveryKey || '').trim();
    var id = String(contentId || '').trim();
    if (key) {
        var keyUrl = 'https://' + hubName + '.cdn.content.amplience.net/content/key/'
            + key.split('/').map(encodeURIComponent).join('/');
        var keyRes = await fetch(keyUrl, { method: 'HEAD' });
        if (keyRes.ok) return true;
    }
    if (id) {
        var idUrl = 'https://' + hubName + '.cdn.content.amplience.net/content/id/'
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

    function sleep(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
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
    var env = readEnv();
    var hubName = env.AMPLIENCE_HUB_NAME || env.VITE_AMPLIENCE_HUB_NAME || '';
    var token = env.AMPLIENCE_PERSONAL_ACCESS_TOKEN || '';
    if (!hubName) throw new Error('AMPLIENCE_HUB_NAME is required in .env');
    if (!token) throw new Error('AMPLIENCE_PERSONAL_ACCESS_TOKEN is required in .env');

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

    console.log('Probing CDN publish status for', items.length, 'items…');
    if (process.argv.indexOf('--probe-cdn') >= 0) {
        await annotateCdnStatus(hubName, items);
    } else {
        console.log('Skipping CDN probe (pass --probe-cdn to check publish status).');
    }

    var payload = {
        ok: true,
        hubName: hubName,
        total: items.length,
        exportedAt: new Date().toISOString(),
        items: items
    };

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
    console.log('Wrote', items.length, 'items to', OUT);
}

main().catch(function (err) {
    console.error(err.message || err);
    process.exit(1);
});
