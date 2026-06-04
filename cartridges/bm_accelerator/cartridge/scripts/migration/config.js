'use strict';

module.exports = {
    ctp: {
        projectKey:   'mars-mms-dev-us',
        clientId:     'gtAOv7COClhBWmOtS_X4gi6h',
        clientSecret: 'b7w2znpzozAcaRuiFmdlc_gcwW-sYPO9',
        authUrl:      'https://auth.us-central1.gcp.commercetools.com',
        apiUrl:       'https://api.us-central1.gcp.commercetools.com',
        scopes:       ''
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
