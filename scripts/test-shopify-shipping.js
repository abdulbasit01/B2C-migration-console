'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
const env = Object.fromEntries(
    fs.readFileSync(envPath, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => {
            const i = l.indexOf('=');
            return [l.slice(0, i), l.slice(i + 1)];
        })
);

const store = env.SHOPIFY_STORE_URL.replace(/\/$/, '');

function req(method, urlPath, body, headers) {
    return new Promise((resolve, reject) => {
        const u = new URL(store + urlPath);
        const opts = {
            method,
            hostname: u.hostname,
            path: u.pathname + u.search,
            headers: headers || {}
        };
        const r = https.request(opts, (x) => {
            let d = '';
            x.on('data', (c) => { d += c; });
            x.on('end', () => resolve({ status: x.statusCode, body: d }));
        });
        r.on('error', reject);
        if (body) r.write(body);
        r.end();
    });
}

const PROFILE_PAGE_SIZE = 25;
const ZONE_PAGE_SIZE = 25;
const METHOD_PAGE_SIZE = 25;

const QUERY = ''
    + 'query AccDeliveryProfiles($cursor: String) {'
    + '  deliveryProfiles(first: ' + PROFILE_PAGE_SIZE + ', after: $cursor) {'
    + '    pageInfo { hasNextPage endCursor }'
    + '    nodes {'
    + '      id name'
    + '      profileLocationGroups {'
    + '        locationGroupZones(first: ' + ZONE_PAGE_SIZE + ') {'
    + '          nodes {'
    + '            zone { id name }'
    + '            methodDefinitions(first: ' + METHOD_PAGE_SIZE + ') {'
    + '              nodes {'
    + '                id name active description'
    + '                rateProvider {'
    + '                  ... on DeliveryRateDefinition {'
    + '                    price { amount currencyCode }'
    + '                  }'
    + '                }'
    + '              }'
    + '            }'
    + '          }'
    + '        }'
    + '      }'
    + '    }'
    + '  }'
    + '}';

(async () => {
    const tokRes = await req(
        'POST',
        '/admin/oauth/access_token',
        'grant_type=client_credentials&client_id='
            + encodeURIComponent(env.SHOPIFY_CLIENT_ID)
            + '&client_secret='
            + encodeURIComponent(env.SHOPIFY_CLIENT_SECRET),
        { 'Content-Type': 'application/x-www-form-urlencoded' }
    );
    const tok = JSON.parse(tokRes.body).access_token;
    const hdr = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': tok };

    for (const ver of ['2025-01', '2026-07']) {
        const gRes = await req(
            'POST',
            '/admin/api/' + ver + '/graphql.json',
            JSON.stringify({ query: QUERY, variables: { cursor: null } }),
            hdr
        );
        const g = JSON.parse(gRes.body);
        if (g.errors) {
            console.log(ver, 'GRAPHQL ERROR:', g.errors[0].message);
            continue;
        }
        let count = 0;
        (g.data.deliveryProfiles.nodes || []).forEach((p) => {
            (p.profileLocationGroups || []).forEach((plg) => {
                ((plg.locationGroupZones && plg.locationGroupZones.nodes) || []).forEach((lgz) => {
                    const zone = lgz.zone || {};
                    ((lgz.methodDefinitions && lgz.methodDefinitions.nodes) || []).forEach((m) => {
                        count++;
                        const key = [p.name, zone.name, m.name || m.description].join('-');
                        console.log(ver, key, '| id:', String(m.id).split('/').pop());
                    });
                });
            });
        });
        console.log(ver, 'total:', count);
    }

    const zonesRes = await req('GET', '/admin/api/2026-07/shipping_zones.json', '', hdr);
    const zones = JSON.parse(zonesRes.body).shipping_zones || [];
    zones.forEach((z) => {
        [...(z.weight_based_shipping_rates || []), ...(z.price_based_shipping_rates || [])].forEach((r) => {
            console.log('LEGACY key:', (z.name || 'zone') + '-' + (r.name || r.id));
        });
    });
})();
