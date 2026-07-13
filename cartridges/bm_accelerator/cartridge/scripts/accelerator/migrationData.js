'use strict';

var platformUiMeta = require('*/cartridge/scripts/accelerator/platformUiMeta');

var WIZARD_STEPS = [
    { id: 1, key: 'connect', label: 'Connect' },
    { id: 2, key: 'fetch',   label: 'Fetch' },
    { id: 3, key: 'aimap',  label: 'AI Map' },
    { id: 4, key: 'move',   label: 'Move' },
    { id: 5, key: 'view',   label: 'View' }
];

var DATA_WIZARD_STEPS = [
    { id: 1, key: 'connect',    label: 'Connect' },
    { id: 2, key: 'selectType', label: 'Select Data' }
];

/** commercetools orderState enum values (see Order.orderState). */
var CTP_ORDER_STATE_VALUES = ['Open', 'Confirmed', 'Complete', 'Cancelled'];

/** commercetools paymentState enum values (see Order.paymentState). */
var CTP_PAYMENT_STATE_VALUES = ['Pending', 'Failed', 'Paid', 'BalanceDue', 'CreditOwed'];

/** Shopify financial_status values for order export filters. */
var SHOPIFY_FINANCIAL_STATUS_VALUES = [
    'pending', 'authorized', 'partially_paid', 'paid', 'partially_refunded', 'refunded', 'voided'
];

/** Shopify fulfillment_status values for order export filters. */
var SHOPIFY_FULFILLMENT_STATUS_VALUES = [
    'unshipped', 'partial', 'shipped', 'fulfilled'
];

var DATA_TYPES = [
    {
        id:          'order',
        label:       'Orders',
        description: 'Export orders from the source platform and generate SFCC IMPEX packages.',
        status:      'ready',
        iconClass:   'acc-data-type--order',
        items:       ['Order header, status and payments', 'Line items and pricing', 'Billing and shipping addresses', 'SFCC IMPEX XML export']
    },
    {
        id:          'customer',
        label:       'Customers',
        description: 'Migrate customer profiles, addresses, and account data into SFCC.',
        status:      'ready',
        iconClass:   'acc-data-type--customer',
        items:       ['Customer profiles', 'Addresses', 'Custom attributes', 'Attribute pre-flight check']
    },
    {
        id:          'product',
        label:       'Products',
        description: 'Migrate product catalog, variants, and attributes into SFCC.',
        status:      'ready',
        iconClass:   'acc-data-type--product',
        items:       ['Product master data', 'Variants & SKUs', 'Custom attributes', 'Full XML/WebDAV import']
    },
    {
        id:          'catalog',
        label:       'Catalog',
        description: 'Migrate categories, catalog structure, and assignments into SFCC.',
        status:      'ready',
        iconClass:   'acc-data-type--catalog',
        items:       ['Category hierarchy', 'Catalog assignments', 'Navigation structure']
    },
    {
        id:          'shippingMethod',
        label:       'Shipping Methods',
        description: 'Migrate shipping methods from the source platform into SFCC via IMPEX XML export.',
        status:      'ready',
        iconClass:   'acc-data-type--shipping',
        items:       ['Shipping method definitions', 'Zone-based rates', 'IMPEX XML export', 'Attribute pre-flight check']
    },
    {
        id:          'inventory',
        label:       'Inventory Lists',
        description: 'Migrate inventory entries from the source platform into an SFCC inventory list.',
        status:      'ready',
        iconClass:   'acc-data-type--inventory',
        items:       ['SKU stock levels', 'Location or supply channel filter', 'Inventory-list XML export', 'Attribute pre-flight check']
    },
    {
        id:          'pricebook',
        label:       'Pricebooks',
        description: 'Migrate product prices from the source platform into SFCC pricebooks.',
        status:      'ready',
        iconClass:   'acc-data-type--pricebook',
        items:       ['Prices by currency', 'Channel or catalog filter', 'Pricebook XML export', 'Attribute pre-flight check']
    },
    {
        id:          'taxation',
        label:       'Taxation',
        description: 'Migrate tax categories and rates from the source platform into SFCC tax tables.',
        status:      'ready',
        iconClass:   'acc-data-type--taxation',
        items:       ['Full tax table XML export', 'Tax classes from source categories', 'Jurisdictions by country/state', 'Tax rate mapping']
    },
    {
        id:          'store',
        label:       'Stores',
        description: 'Migrate physical stores or locations from the source platform into SFCC store definitions.',
        status:      'ready',
        iconClass:   'acc-data-type--store',
        items:       ['Full store list XML export', 'Store or location mapping', 'Address enrichment', 'Store locator flags']
    }
];

var PLATFORMS = [
    {
        id:          'commercetools',
        name:        'commercetools',
        tagline:     'API-first, Business Units, Headless',
        status:      'ready',
        confidence:  75,
        featured:    true,
        description: 'Migrate commercetools customers, products, categories, orders, and price lists into Salesforce B2C Commerce, mapping catalogs/pricing models with moderate transformation and extensions.',
        iconClass:   'platform-icon--commercetools',
        connectHint: 'Credentials are pre-loaded from your project configuration.',
        connectFields: [
            { name: 'projectKey',   label: 'Project key',   type: 'text',     required: true,  value: '' },
            { name: 'clientId',     label: 'Client ID',     type: 'text',     required: true,  value: '' },
            { name: 'clientSecret', label: 'Client secret', type: 'password', required: true,  value: '' },
            { name: 'apiUrl',       label: 'API URL',       type: 'text',     required: true,  value: '' }
        ]
    },
    {
        id:          'shopify',
        name:        'Shopify',
        tagline:     'B2C, Markets, Headless',
        status:      'ready',
        confidence:  92,
        description: 'Migrate Shopify customers, products, collections, orders, and price lists into Salesforce B2C Commerce with high-confidence field mapping.',
        iconClass:   'platform-icon--shopify',
        connectHint: 'Install the app on your store in Shopify Partners, then enter Client ID and Secret. Alternatively, paste an Admin API access token (shpat_…) in the Secret field.',
        connectFields: [
            { name: 'storeUrl',      label: 'Store URL',    type: 'text',     required: true,  value: '', placeholder: 'https://your-store.myshopify.com' },
            { name: 'clientId',      label: 'Client ID',    type: 'text',     required: false, value: '', placeholder: '' },
            { name: 'clientSecret',  label: 'Client secret or Admin API token', type: 'password', required: true,  value: '', placeholder: 'shpss_… or shpat_…' },
            { name: 'apiVersion',    label: 'API version',  type: 'text',     required: false, value: '2026-07', placeholder: '' }
        ]
    },
    {
        id:          'bigcommerce',
        name:        'BigCommerce',
        tagline:     'B2C Edition, Multi-store',
        status:      'soon',
        confidence:  88,
        description: 'Migrate BigCommerce B2C customers, catalog, categories, orders, and contract pricing into Salesforce B2C Commerce.',
        iconClass:   'platform-icon--bigcommerce',
        connectHint: 'Provide your BigCommerce store hash and API credentials.',
        connectFields: [
            { name: 'storeHash',   label: 'Store hash',   type: 'text',     required: true, value: '' },
            { name: 'clientId',    label: 'Client ID',    type: 'text',     required: true, value: '' },
            { name: 'accessToken', label: 'Access token', type: 'password', required: true, value: '' }
        ]
    },
    {
        id:          'sap',
        name:        'SAP Commerce',
        tagline:     'B2C, OCC, Integrations',
        status:      'soon',
        confidence:  0,
        description: 'SAP Commerce Cloud to Salesforce B2C Commerce migration path (planned).',
        iconClass:   'platform-icon--sap',
        connectHint: '',
        connectFields: []
    }
];

// ─── Credential injection ─────────────────────────────────────────────────────

/**
 * Clone a platform and pre-fill its connect fields with stored credentials.
 * Delegates to the platform's connector (if registered) via injectCredentials().
 * Adding a new platform only requires registering its connector — no changes here.
 *
 * @param {Object} platform
 * @returns {Object} cloned platform (original is never mutated)
 */
function withCredentials(platform) {
    if (!platform) return null;

    var registry;
    try {
        registry = require('*/cartridge/scripts/migration/connectors/registry');
    } catch (e) {
        return platform;
    }

    var connector = registry.get(platform.id);
    if (!connector || typeof connector.injectCredentials !== 'function') return platform;

    var migCfg;
    try {
        migCfg = require('*/cartridge/scripts/migration/configAccessor');
    } catch (e) {
        return platform;
    }

    return {
        id:            platform.id,
        name:          platform.name,
        tagline:       platform.tagline,
        status:        platform.status,
        confidence:    platform.confidence,
        featured:      platform.featured,
        description:   platform.description,
        iconClass:     platform.iconClass,
        connectHint:   platform.connectHint,
        connectFields: connector.injectCredentials(platform.connectFields, migCfg)
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

function getPlatform(platformId) {
    var id = platformId || '';
    for (var i = 0; i < PLATFORMS.length; i++) {
        if (PLATFORMS[i].id === id) return withCredentials(PLATFORMS[i]);
    }
    return null;
}

function getPlatforms() {
    var seen = {};
    var list = [];
    for (var i = 0; i < PLATFORMS.length; i++) {
        var p = PLATFORMS[i];
        if (!seen[p.id]) {
            seen[p.id] = true;
            list.push(withCredentials(p));
        }
    }
    return list;
}

function getWizardSteps() {
    var steps = [];
    for (var i = 0; i < WIZARD_STEPS.length; i++) {
        var s = WIZARD_STEPS[i];
        steps.push({ id: parseInt(String(s.id), 10), key: s.key, label: s.label });
    }
    return steps;
}

function getWizardStep(step) {
    var stepNum = Math.min(Math.max(parseInt(String(step), 10) || 1, 1), WIZARD_STEPS.length);
    return WIZARD_STEPS[stepNum - 1];
}

function getNextStepLabel() {
    return 'Continue';
}

function getDataWizardSteps(dataTypeId) {
    if (dataTypeId === 'product' || dataTypeId === 'catalog') {
        return cloneSteps(DATA_WIZARD_STEPS).concat([
            { id: 3, key: 'typePlaceholder', label: 'Migrate' }
        ]);
    }
    return cloneSteps(DATA_WIZARD_STEPS);
}

function cloneSteps(steps) {
    var out = [];
    for (var i = 0; i < steps.length; i++) {
        out.push({
            id:    parseInt(String(steps[i].id), 10),
            key:   steps[i].key,
            label: steps[i].label
        });
    }
    return out;
}

function getMaxDataStep(dataTypeId) {
    return getDataWizardSteps(dataTypeId).length;
}

function getDataWizardStep(step, dataTypeId) {
    var steps   = getDataWizardSteps(dataTypeId);
    var stepNum = Math.min(Math.max(parseInt(String(step), 10) || 1, 1), steps.length);
    return steps[stepNum - 1];
}

function formatShopifyLabel(value) {
    return String(value)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function buildStatusFilters(values, formatLabel) {
    var filters = [{ value: '', key: 'all', label: 'All' }];
    var fmt     = formatLabel || function (v) { return v; };
    var i;

    for (i = 0; i < values.length; i++) {
        var val = values[i];
        filters.push({
            value: val,
            key:   String(val).toLowerCase(),
            label: fmt(val)
        });
    }
    return filters;
}

function getCtpOrderStateFilters() {
    return buildStatusFilters(CTP_ORDER_STATE_VALUES);
}

function getCtpPaymentStateFilters() {
    return buildStatusFilters(CTP_PAYMENT_STATE_VALUES, function (v) {
        if (v === 'BalanceDue') return 'Balance due';
        if (v === 'CreditOwed') return 'Credit owed';
        return v;
    });
}

function getShopifyFinancialStatusFilters() {
    return buildStatusFilters(SHOPIFY_FINANCIAL_STATUS_VALUES, formatShopifyLabel);
}

function getShopifyFulfillmentStatusFilters() {
    return buildStatusFilters(SHOPIFY_FULFILLMENT_STATUS_VALUES, formatShopifyLabel);
}

/**
 * @param {string} [platformId]
 * @returns {Array}
 */
function getOrderStateFilters(platformId) {
    if (platformId === 'shopify') return getShopifyFinancialStatusFilters();
    return getCtpOrderStateFilters();
}

/**
 * @param {string} [platformId]
 * @returns {Array}
 */
function getPaymentStateFilters(platformId) {
    if (platformId === 'shopify') return getShopifyFulfillmentStatusFilters();
    return getCtpPaymentStateFilters();
}

function isValidCtpOrderState(value) {
    return !value || CTP_ORDER_STATE_VALUES.indexOf(value) >= 0;
}

function isValidCtpPaymentState(value) {
    return !value || CTP_PAYMENT_STATE_VALUES.indexOf(value) >= 0;
}

function isValidShopifyFinancialStatus(value) {
    return !value || SHOPIFY_FINANCIAL_STATUS_VALUES.indexOf(value) >= 0;
}

function isValidShopifyFulfillmentStatus(value) {
    return !value || SHOPIFY_FULFILLMENT_STATUS_VALUES.indexOf(value) >= 0;
}

/**
 * @param {string} [platformId]
 * @param {string} value
 * @returns {boolean}
 */
function isValidOrderState(platformId, value) {
    if (platformId === 'shopify') return isValidShopifyFinancialStatus(value);
    return isValidCtpOrderState(value);
}

/**
 * @param {string} [platformId]
 * @param {string} value
 * @returns {boolean}
 */
function isValidPaymentState(platformId, value) {
    if (platformId === 'shopify') return isValidShopifyFulfillmentStatus(value);
    return isValidCtpPaymentState(value);
}

function getDataTypes() {
    var types = [];
    for (var i = 0; i < DATA_TYPES.length; i++) {
        types.push(DATA_TYPES[i]);
    }
    return types;
}

function getDataType(typeId) {
    for (var i = 0; i < DATA_TYPES.length; i++) {
        if (DATA_TYPES[i].id === typeId) return DATA_TYPES[i];
    }
    return null;
}

/**
 * Platform-aware UI copy for data migration module pages.
 * @param {string} [platformId]
 * @returns {Object}
 */
function getMigrationUi(platformId) {
    var id   = platformId || 'commercetools';
    var pick = function (map) { return platformUiMeta.pickStr(id, map); };
    var ui   = platformUiMeta.getCommonUiLabels(id);

    ui.invIntro = pick({
        shopify: 'Migrate <strong>inventory levels</strong> from Shopify (SKU stock per location) into an SFCC inventory list you name below. The list is created when you import the generated IMPEX XML in Business Manager.',
        commercetools: 'Migrate <strong>inventory entries</strong> from commercetools (SKU stock levels per supply channel) into an SFCC inventory list you name below. The list is created when you import the generated IMPEX XML in Business Manager.'
    });
    ui.invAttrScan = pick({
        shopify: 'Shopify inventory migration uses native fields only (SKU and quantity per location). No custom ProductInventoryRecord attributes are required from Shopify metafields.',
        commercetools: 'Scans CTP <strong>inventory-entry</strong> custom-type field definitions and checks whether matching attributes exist on the SFCC <strong>ProductInventoryRecord</strong> system object. Standard fields (SKU, quantity, supply channel) map to native inventory XML and are not listed here.'
    });
    ui.loadChannelsBtn = pick({ shopify: 'Load Inventory Lists', commercetools: 'Load Channels' });
    ui.reloadChannelsBtn = pick({ shopify: 'Reload Inventory Lists', commercetools: 'Reload Channels' });
    ui.loadChannelsHint = pick({
        shopify: 'Click <strong>Load Inventory Lists</strong> to discover Shopify inventory sources and level counts for each SFCC list.',
        commercetools: 'Click <strong>Load Channels</strong> to fetch supply channels and CTP entry counts.'
    });
    ui.entryCountCol = pick({ shopify: 'Inventory Levels', commercetools: 'CTP Entries' });
    ui.channelSelectHelp = pick({
        shopify: 'Use <strong>Aggregated</strong> for one SFCC inventory list summed across all Shopify locations, or pick individual location-based lists.',
        commercetools: 'Use <strong>Aggregated</strong> to sum stock across all channels per SKU, or pick individual supply channels.'
    });
    ui.invHowWorks = pick({
        shopify: 'Fetches inventory levels from Shopify in pages of 500, builds one SFCC inventory-list XML per selected target, and uploads to WebDAV at',
        commercetools: 'Fetches inventory entries from commercetools <code>/inventory</code> in pages of 500, builds one SFCC inventory-list XML per selected target, and uploads to WebDAV at'
    });

    ui.pbIntro = pick({
        shopify: 'Migrate <strong>Shopify variant prices</strong> into SFCC pricebooks. Use <strong>Standalone Prices</strong> for catalog variant prices, or <strong>Product Embedded Prices</strong> for the same data grouped from products.',
        commercetools: 'Migrate commercetools prices into SFCC pricebooks. Use <strong>Standalone Prices</strong> for CTP <code>/standalone-prices</code>, or <strong>Product Embedded Prices</strong> to scan each product for variant prices.'
    });
    ui.pbAttrScan = pick({
        shopify: 'Scans Shopify price-related metafield definitions and checks whether matching attributes exist on the SFCC <strong>PriceBook</strong> system object.',
        commercetools: 'Scans CTP <strong>standalone-price</strong> custom-type field definitions and checks whether matching attributes exist on the SFCC <strong>PriceBook</strong> system object.'
    });
    ui.pbStandaloneHelp = pick({
        shopify: 'Pricebooks discovered from <strong>Shopify variant prices</strong>, grouped by shop currency.',
        commercetools: 'Pricebooks discovered from CTP <strong>/standalone-prices</strong>, grouped by currency and distribution channel.'
    });
    ui.pbStandaloneLoading = pick({
        shopify: 'Click <strong>Load Standalone</strong> to scan variant prices from Shopify.',
        commercetools: 'Click <strong>Load Standalone</strong> to scan standalone prices from commercetools.'
    });
    ui.pbEmbeddedHelp = pick({
        shopify: 'Scans every Shopify product and extracts variant <strong>prices</strong> grouped by currency.',
        commercetools: 'Scans every CTP product and extracts variant <strong>embedded prices</strong> grouped by currency and channel.'
    });
    ui.pbEmbeddedLoading = pick({
        shopify: 'Click <strong>Load Embedded</strong> to scan products for variant prices.',
        commercetools: 'Click <strong>Load Embedded</strong> to scan products for embedded prices.'
    });
    ui.pbNoStandalone = pick({
        shopify: 'No variant prices found in Shopify.',
        commercetools: 'No standalone prices found in commercetools.'
    });
    ui.pbNoEmbedded = pick({
        shopify: 'No embedded prices found on Shopify products.',
        commercetools: 'No embedded prices found on CTP products.'
    });

    ui.storeIntro = pick({
        shopify: 'Select Shopify <strong>locations</strong> to export into one SFCC store IMPEX XML file (physical stores / store locator).',
        commercetools: 'Select CTP <strong>stores</strong> to export into one SFCC store IMPEX XML file (physical stores / store locator).'
    });
    ui.storeAttrScan = pick({
        shopify: 'Scans Shopify <strong>location</strong> metafield definitions and checks whether matching attributes exist on the SFCC <strong>Store</strong> system object. Standard fields (name, address, geo, flags) map to native store XML and are not listed here.',
        commercetools: 'Scans CTP <strong>store</strong> custom-type field definitions and checks whether matching attributes exist on the SFCC <strong>Store</strong> system object. Standard fields (name, address, geo, flags) map to native store XML and are not listed here. Migration also requires traceability attributes such as <code>ctpStoreId</code> and <code>ctpStoreKey</code>.'
    });
    ui.loadStoresHint = pick({
        shopify: 'Click <strong>Load Stores</strong> to fetch locations from Shopify.',
        commercetools: 'Click <strong>Load Stores</strong> to fetch stores from commercetools.'
    });
    ui.storeKeyCol = pick({ shopify: 'Location ID', commercetools: 'CTP Key' });
    ui.noStores = pick({
        shopify: 'No locations found in Shopify.',
        commercetools: 'No stores found in commercetools. Create stores in CTP Merchant Center.'
    });

    ui.taxIntro = pick({
        shopify: 'Export Shopify <strong>country and province tax rates</strong> into one SFCC tax IMPEX XML file (tax classes, jurisdictions, and rates).',
        commercetools: 'Export CTP <strong>tax categories</strong> and rates into one SFCC tax IMPEX XML file (tax classes, jurisdictions, and rates).'
    });
    ui.taxAttrScan = pick({
        shopify: 'Verifies SFCC <strong>TaxClass</strong> attributes for any Shopify metafields that apply to tax migration. Shopify tax settings use native country/province rates and map to SFCC tax tables.',
        commercetools: 'Verifies SFCC <strong>TaxClass</strong> attributes for any CTP custom fields that apply to tax migration. CTP tax categories use native fields only (name, rates, country) and map to SFCC tax tables.'
    });
    ui.loadTaxBtn = pick({ shopify: 'Load from Shopify', commercetools: 'Load from CTP' });
    ui.loadTaxHint = pick({
        shopify: 'Click <strong>Load from Shopify</strong> to fetch tax classes and rates.',
        commercetools: 'Click <strong>Load from CTP</strong> to fetch tax classes and rates.'
    });
    ui.taxOverviewHelp = pick({
        shopify: 'Review Shopify tax jurisdictions before export. Regions with a <strong>0%</strong> rate are included so SFCC matches your Shopify tax setup; you can adjust rates in Business Manager after import.',
        commercetools: 'Review tax classes and countries found in commercetools before building the export XML.'
    });
    ui.taxHowWorks = pick({
        shopify: 'Fetches tax settings from Shopify, maps rates to SFCC tax classes and jurisdictions, and builds one IMPEX XML file.',
        commercetools: 'Fetches all tax categories from commercetools, maps CTP rates to SFCC tax classes and jurisdictions, and builds one IMPEX XML file.'
    });
    ui.noTaxRates = pick({
        shopify: 'No tax jurisdictions found in Shopify. Add countries to your shipping zones and configure tax settings in Shopify admin.',
        commercetools: 'No tax rates found in commercetools. Add tax categories and rates in CTP Merchant Center.'
    });
    ui.taxAllRatesZero = pick({
        shopify: 'All jurisdictions will export at 0%. Update tax rates in Business Manager after import.',
        commercetools: 'All tax rates are 0%. Verify rates in commercetools before export.',
        _generic: 'All jurisdictions will export at 0%. Update tax rates in Business Manager after import.'
    });

    ui.shipIntro = pick({
        shopify: 'Export <strong>Shopify shipping rates</strong> into SFCC shipping-method IMPEX XML for Business Manager import.',
        commercetools: 'Export <strong>commercetools shipping methods</strong> into SFCC shipping-method IMPEX XML for Business Manager import.'
    });
    ui.shipAttrScan = pick({
        shopify: 'Scans Shopify shipping-related metafield definitions and checks whether matching attributes exist on the SFCC <strong>ShippingMethod</strong> system object. Standard shipping fields map to native SFCC shipping-method XML and are not listed here.',
        commercetools: 'Scans CTP shipping-method <strong>custom-type</strong> field definitions and checks whether matching attributes exist on the SFCC <strong>ShippingMethod</strong> system object. Standard CTP fields (key, name, rates, etc.) map to native SFCC shipping-method XML fields and are not listed here.'
    });
    ui.loadMethodsHint = pick({
        shopify: 'Click <strong>Load Methods</strong> to fetch shipping zones and rates from Shopify.',
        commercetools: 'Click <strong>Load Methods</strong> to fetch shipping methods from commercetools.'
    });
    ui.shipKeyCol = pick({ shopify: 'Rate ID', commercetools: 'CTP Key' });
    ui.shipHowWorks = pick({
        shopify: 'Fetches shipping methods from Shopify, builds SFCC shipping import XML,',
        commercetools: 'Fetches shipping methods from commercetools, builds SFCC shipping import XML,'
    });
    ui.shipImportHint = pick({
        shopify: 'Import shipping methods in Business Manager and point the import at the uploaded XML file.',
        commercetools: 'Import shipping methods in Business Manager and point the import at the uploaded XML file.',
        _generic: 'Import shipping methods in Business Manager and point the import at the uploaded XML file.'
    });
    ui.noShipMethods = pick({
        shopify: 'No shipping rates found in Shopify.',
        commercetools: 'No shipping methods found in commercetools.'
    });
    ui.loadingShipMethods = pick({
        shopify: 'Loading shipping methods from Shopify...',
        commercetools: 'Loading shipping methods from commercetools...'
    });

    ui.orderAttrScan = pick({
        shopify: 'Scans Shopify <strong>order</strong> metafield definitions and checks whether matching attributes exist on the SFCC <strong>Order</strong> system object.',
        commercetools: 'Scans CTP <strong>order</strong> custom-type field definitions and checks whether matching attributes exist on the SFCC <strong>Order</strong> system object.'
    });
    ui.orderHowWorks = pick({
        shopify: 'Fetches orders from Shopify in pages, maps and validates each order, and streams one SFCC order XML to',
        commercetools: 'Fetches orders from commercetools in pages, maps and validates each order, and streams one SFCC order XML to'
    });
    ui.pbHowWorks = pick({
        shopify: 'Select pricebooks from either section (or both). Each generates SFCC pricebook XML with <code>price-table</code> entries per SKU, uploaded to WebDAV. Variant prices are read from Shopify products.',
        commercetools: 'Select pricebooks from either section (or both). Each generates SFCC pricebook XML with <code>price-table</code> entries per SKU, uploaded to WebDAV. Standalone prices are fetched from <code>/standalone-prices</code>; embedded prices are extracted from each product variant.'
    });
    ui.storeHowWorks = pick({
        shopify: 'Fetches selected locations from Shopify, maps them to SFCC <code>store</code> elements, and uploads a single XML file to WebDAV.',
        commercetools: 'Fetches selected stores from commercetools, maps them to SFCC <code>store</code> elements, and uploads a single XML file to WebDAV.'
    });
    ui.orderIntro = pick({
        shopify: 'Export orders from <strong>Shopify</strong> for the selected date range and generate an SFCC IMPEX package.',
        commercetools: 'Export orders from <strong>commercetools</strong> for the selected date range and generate an SFCC IMPEX package.'
    });
    ui.orderStateLabel = pick({ shopify: 'Financial status', commercetools: 'Order state' });
    ui.paymentStateLabel = pick({ shopify: 'Fulfillment status', commercetools: 'Payment state' });

    ui.reloadingTax = pick({
        shopify: 'Reloading tax data from Shopify...',
        commercetools: 'Reloading tax data from commercetools...'
    });
    ui.loadingTax = pick({
        shopify: 'Loading tax data from Shopify...',
        commercetools: 'Loading tax data from commercetools...'
    });
    ui.reloadTaxBtn = pick({ shopify: 'Reload from Shopify', commercetools: 'Reload from CTP' });

    ui.reloadingShipMethods = pick({
        shopify: 'Reloading shipping methods from Shopify...',
        commercetools: 'Reloading shipping methods from commercetools...'
    });

    ui.loadingChannels = pick({
        shopify: 'Loading inventory lists from Shopify...',
        commercetools: 'Loading supply channels from commercetools...'
    });
    ui.reloadingChannels = pick({
        shopify: 'Reloading inventory lists from Shopify...',
        commercetools: 'Reloading supply channels from commercetools...'
    });
    ui.invTotalEntriesSuffix = pick({
        shopify: ' total inventory levels',
        commercetools: ' total CTP entries'
    });
    ui.invNoChannels = pick({
        shopify: 'No inventory list sources found — aggregated export only',
        commercetools: 'No CTP supply channels found — aggregated export only'
    });
    ui.invAggregatedLabel = pick({
        shopify: 'Aggregated (all inventory lists)',
        commercetools: 'Aggregated (all channels)'
    });
    ui.invAggregatedSub = pick({
        shopify: 'Sums stock per SKU across all locations',
        commercetools: 'Sums stock per SKU across all supply channels'
    });

    ui.loadingStores = pick({
        shopify: 'Loading stores from Shopify...',
        commercetools: 'Loading stores from commercetools...'
    });
    ui.reloadingStores = pick({
        shopify: 'Reloading stores from Shopify...',
        commercetools: 'Reloading stores from commercetools...'
    });

    return ui;
}

/**
 * @param {string} platformId
 * @returns {string}
 */
function getMigrationUiJson(platformId) {
    try {
        return JSON.stringify(getMigrationUi(platformId));
    } catch (e) {
        return '{}';
    }
}

/**
 * Build Step 2 content — panel layout matching schema Fetch step.
 * @returns {Object} step content with sections for ISML
 */
function buildDataSelectContent() {
    var readySections = [];
    var soonSections  = [];
    var readyCount    = 0;

    for (var i = 0; i < DATA_TYPES.length; i++) {
        var dt = DATA_TYPES[i];
        var section = {
            taskId:     dt.id,
            title:      dt.label,
            items:      dt.items || [dt.description],
            selectable: dt.status === 'ready'
        };
        if (dt.status === 'ready') {
            readySections.push(section);
            readyCount++;
        } else {
            soonSections.push(section);
        }
    }

    var sections = readySections.concat(soonSections);

    return {
        titleSuffix: 'Select data to migrate',
        intro:       'Choose one data type to migrate. Each type follows its own migration flow.',
        sections:    sections,
        summary:     readyCount + ' data type(s) ready'
    };
}

module.exports = {
    getPlatform:         getPlatform,
    getPlatforms:        getPlatforms,
    getWizardSteps:      getWizardSteps,
    getWizardStep:       getWizardStep,
    getNextStepLabel:    getNextStepLabel,
    maxStep:             WIZARD_STEPS.length,
    getDataWizardSteps:     getDataWizardSteps,
    getDataWizardStep:      getDataWizardStep,
    getMaxDataStep:         getMaxDataStep,
    getCtpOrderStateFilters:   getCtpOrderStateFilters,
    getCtpPaymentStateFilters: getCtpPaymentStateFilters,
    getOrderStateFilters:      getOrderStateFilters,
    getPaymentStateFilters:    getPaymentStateFilters,
    isValidCtpOrderState:      isValidCtpOrderState,
    isValidCtpPaymentState:    isValidCtpPaymentState,
    isValidOrderState:         isValidOrderState,
    isValidPaymentState:       isValidPaymentState,
    getDataTypes:           getDataTypes,
    getDataType:            getDataType,
    getMigrationUi:         getMigrationUi,
    getMigrationUiJson:     getMigrationUiJson,
    getPlatformUiMeta:      platformUiMeta.getPlatformUiMeta,
    buildDataSelectContent: buildDataSelectContent
};
