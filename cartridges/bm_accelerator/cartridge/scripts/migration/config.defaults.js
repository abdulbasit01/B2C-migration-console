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
        projectKey:   'royal-cyber-b2c-accelerator-wd',
        clientId:     'PWqDRs2lknl77oBfOxZOXrro',
        clientSecret: '4RkXFLeoN4OVxDAE4Cd0j7NqMtQ5TT-u',
        authUrl:      'https://auth.australia-southeast1.gcp.commercetools.com',
        apiUrl:       'https://api.australia-southeast1.gcp.commercetools.com'
    },
    sfcc: {
        bmClientId:      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        version:         'v20_10',
        metaVersion:     'v20_10',
        catalogId:       'storefront-catalog-m-en',
        inventoryListId: 'migrated-inventory',
        customerListId:  ''
    },
    migration: {
        batchSize: 20,
        dryRun:    false
    }
};
