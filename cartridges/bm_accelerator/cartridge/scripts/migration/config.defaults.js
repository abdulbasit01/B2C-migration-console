'use strict';

/**
 * Safe defaults when config.js has not been generated/uploaded yet.
 * Run `npm run config:generate` (from code/app) after filling .env + dw.json.
 */
module.exports = {
    shopify: {
        storeUrl:     '',
        clientId:     '',
        clientSecret: '',
        apiVersion:   '2025-01'
    },
    ctp: {
        projectKey:   '',
        clientId:     '',
        clientSecret: '',
        authUrl:      'https://auth.us-central1.gcp.commercetools.com',
        apiUrl:       'https://api.us-central1.gcp.commercetools.com'
    },
    sfcc: {
        bmClientId:      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        version:         'v25_6',
        metaVersion:     'v25_6',
        catalogId:       'storefront-catalog-m-en',
        inventoryListId: 'migrated-inventory'
    },
    migration: {
        batchSize: 20,
        dryRun:    false
    }
};
