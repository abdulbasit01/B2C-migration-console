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
        apiUrl:       'https://api.australia-southeast1.gcp.commercetools.com',
        scopes:       'manage_checkout_applications:royal-cyber-b2c-accelerator-wd manage_checkout_payment_integrations:royal-cyber-b2c-accelerator-wd view_api_clients:royal-cyber-b2c-accelerator-wd manage_order_edits:royal-cyber-b2c-accelerator-wd manage_api_clients:royal-cyber-b2c-accelerator-wd manage_customer_groups:royal-cyber-b2c-accelerator-wd manage_project:royal-cyber-b2c-accelerator-wd manage_connectors:royal-cyber-b2c-accelerator-wd manage_categories:royal-cyber-b2c-accelerator-wd manage_customers:royal-cyber-b2c-accelerator-wd manage_sessions:royal-cyber-b2c-accelerator-wd manage_connectors_deployments:royal-cyber-b2c-accelerator-wd manage_business_units:royal-cyber-b2c-accelerator-wd manage_audit_log:royal-cyber-b2c-accelerator-wd manage_extensions:royal-cyber-b2c-accelerator-wd manage_mcp_servers:royal-cyber-b2c-accelerator-wd manage_checkout_transactions:royal-cyber-b2c-accelerator-wd manage_payment_methods:royal-cyber-b2c-accelerator-wd manage_products:royal-cyber-b2c-accelerator-wd manage_attribute_groups:royal-cyber-b2c-accelerator-wd manage_associate_roles:royal-cyber-b2c-accelerator-wd manage_approval_rules:royal-cyber-b2c-accelerator-wd manage_discount_codes:royal-cyber-b2c-accelerator-wd manage_approval_flows:royal-cyber-b2c-accelerator-wd manage_locked_carts:royal-cyber-b2c-accelerator-wd manage_orders:royal-cyber-b2c-accelerator-wd manage_checkout_payment_intents:royal-cyber-b2c-accelerator-wd manage_payments:royal-cyber-b2c-accelerator-wd manage_product_selections:royal-cyber-b2c-accelerator-wd manage_cart_discounts:royal-cyber-b2c-accelerator-wd view_products:royal-cyber-b2c-accelerator-wd manage_import_containers:royal-cyber-b2c-accelerator-wd manage_key_value_documents:royal-cyber-b2c-accelerator-wd'
    },
    sfcc: {
        bmClientId:      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        version:         'v25_6',
        metaVersion:     'v25_6',
        catalogId:       'storefront-catalog-m-en',
        inventoryListId: 'migrated-inventory',
        customerListId:  ''
    },
    migration: {
        batchSize: 20,
        dryRun:    false
    }
};
