'use strict';

/**
 * Empty defaults when Site Preferences are not configured.
 * NEVER put real credentials here — LINK certification requirement.
 * Configure via Site Preferences → B2C Migration Console.
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
    sap: {
        baseUrl:      '',
        baseSite:     '',
        clientId:     '',
        clientSecret: ''
    },
    sfcc: {
        bmClientId:      '',
        version:         'v25_6',
        metaVersion:     'v25_6',
        catalogId:       '',
        inventoryListId: 'migrated-inventory',
        customerListId:  ''
    },
    amplience: {
        hubName:             '',
        personalAccessToken: '',
        clientId:            '',
        clientSecret:        '',
        defaultDeliveryKey:  ''
    }
};
