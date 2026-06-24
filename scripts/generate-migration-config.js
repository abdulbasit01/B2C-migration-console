/**
 * Generates two files from dw.json + .env:
 *
 *  1. config.js          — CTP credentials + non-sensitive SFCC settings
 *  2. sfcc-credentials.js — SFCC BM username/password from dw.json only
 *
 * Both files are gitignored and auto-generated before every upload.
 * Run: npm run config:generate
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT, 'cartridges/bm_accelerator/cartridge/scripts/migration');

// ── 1. Read dw.json ──────────────────────────────────────────────────────────
const dwPath = path.join(ROOT, 'dw.json');
if (!fs.existsSync(dwPath)) {
    console.error('ERROR: dw.json not found.');
    process.exit(1);
}
const dw = JSON.parse(fs.readFileSync(dwPath, 'utf8'));
if (!dw.hostname || !dw.username || !dw.password) {
    console.error('ERROR: dw.json must have hostname, username, and password.');
    process.exit(1);
}

// ── 2. Read .env ─────────────────────────────────────────────────────────────
const envPath = path.join(ROOT, '.env');
if (!fs.existsSync(envPath)) {
    console.error('ERROR: .env not found. Copy .env.example to .env and fill in CTP credentials.');
    process.exit(1);
}
const env = {};
fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...rest] = trimmed.split('=');
    env[key.trim()] = rest.join('=').trim();
});

const hasShopify = env.SHOPIFY_STORE_URL && env.SHOPIFY_ACCESS_TOKEN;
const hasCtp     = env.CTP_PROJECT_KEY && env.CTP_CLIENT_ID && env.CTP_CLIENT_SECRET;
if (!hasShopify && !hasCtp) {
    console.error('ERROR: At least one source platform must be configured.');
    console.error('  For Shopify:       set SHOPIFY_STORE_URL + SHOPIFY_ACCESS_TOKEN');
    console.error('  For commercetools: set CTP_PROJECT_KEY + CTP_CLIENT_ID + CTP_CLIENT_SECRET');
    process.exit(1);
}

// ── 3. Write config.js (Shopify + CTP + non-sensitive SFCC settings) ────────
const config = {
    shopify: {
        storeUrl:    env.SHOPIFY_STORE_URL    || '',
        accessToken: env.SHOPIFY_ACCESS_TOKEN || '',
        apiVersion:  env.SHOPIFY_API_VERSION  || '2025-01'
    },
    ctp: {
        projectKey:   env.CTP_PROJECT_KEY,
        clientId:     env.CTP_CLIENT_ID,
        clientSecret: env.CTP_CLIENT_SECRET,
        authUrl:      env.CTP_AUTH_URL || 'https://auth.us-central1.gcp.commercetools.com',
        apiUrl:       env.CTP_API_URL  || 'https://api.us-central1.gcp.commercetools.com'
    },
    sfcc: {
        bmClientId:      env.SFCC_BM_CLIENT_ID     || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        version:         env.SFCC_VERSION           || 'v25_6',
        metaVersion:     env.SFCC_META_VERSION      || 'v25_6',
        catalogId:       env.SFCC_CATALOG_ID        || 'storefront-catalog-m-en',
        inventoryListId: env.SFCC_INVENTORY_LIST_ID || 'migrated-inventory'
    },
    migration: {
        batchSize: parseInt(env.BATCH_SIZE) || 20,
        dryRun:    env.DRY_RUN === 'true'
    }
};

fs.writeFileSync(
    path.join(SCRIPTS_DIR, 'config.js'),
    '/* AUTO-GENERATED — do not commit. Run: npm run config:generate */\n\'use strict\';\n\nmodule.exports = ' + JSON.stringify(config, null, 4) + ';\n'
);

// ── 4. Write sfcc-credentials.js (BM username/password from dw.json only) ───
const creds = {
    bmUsername: dw.username,
    bmPassword: dw.password
};

fs.writeFileSync(
    path.join(SCRIPTS_DIR, 'sfcc-credentials.js'),
    '/* AUTO-GENERATED — do not commit. Run: npm run config:generate */\n\'use strict\';\n\nmodule.exports = ' + JSON.stringify(creds, null, 4) + ';\n'
);

// ── 5. Summary ───────────────────────────────────────────────────────────────
console.log('Generated:');
console.log('  config.js          — CTP credentials (from .env)');
console.log('  sfcc-credentials.js — BM username/password (from dw.json)');
console.log('');
if (hasShopify) console.log('  Shopify store   : ' + env.SHOPIFY_STORE_URL);
if (hasCtp)     console.log('  CTP project     : ' + env.CTP_PROJECT_KEY);
console.log('  SFCC host       : ' + dw.hostname + '  (read at runtime)');
console.log('  BM user         : ' + dw.username);
