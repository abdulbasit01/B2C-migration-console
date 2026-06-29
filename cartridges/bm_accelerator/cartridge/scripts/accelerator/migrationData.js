'use strict';

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

var ORDER_DATA_WIZARD_STEPS = [
    { id: 1, key: 'connect',        label: 'Connect' },
    { id: 2, key: 'selectType',     label: 'Select Data' },
    { id: 3, key: 'orderConfigure', label: 'Configure' },
    { id: 4, key: 'orderExport',    label: 'Export' },
    { id: 5, key: 'orderReview',    label: 'Finish' }
];

var ORDER_EXPORT_PHASES = [
    { id: 'fetch',    label: 'Fetch orders from commercetools' },
    { id: 'map',      label: 'Map to canonical order model' },
    { id: 'validate', label: 'Validate order data' },
    { id: 'generate', label: 'Generate SFCC order XML' },
    { id: 'package',  label: 'Package IMPEX files' }
];

/** commercetools orderState enum values (see Order.orderState). */
var CTP_ORDER_STATE_VALUES = ['Open', 'Confirmed', 'Complete', 'Cancelled'];

/** commercetools paymentState enum values (see Order.paymentState). */
var CTP_PAYMENT_STATE_VALUES = ['Pending', 'Failed', 'Paid', 'BalanceDue', 'CreditOwed'];

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
        connectHint: 'Enter your Shopify store URL and Admin API credentials.',
        connectFields: [
            { name: 'storeUrl',      label: 'Store URL',    type: 'text',     required: true,  value: '', placeholder: 'https://your-store.myshopify.com' },
            { name: 'clientId',      label: 'Client ID',    type: 'text',     required: true,  value: '', placeholder: '' },
            { name: 'clientSecret',  label: 'Secret',       type: 'password', required: true,  value: '', placeholder: '' },
            { name: 'apiVersion',    label: 'API version',  type: 'text',     required: false, value: '2025-01', placeholder: '' }
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
    if (dataTypeId === 'order') {
        return cloneSteps(ORDER_DATA_WIZARD_STEPS);
    }
    if (dataTypeId) {
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

function getOrderExportPhases() {
    var phases = [];
    for (var i = 0; i < ORDER_EXPORT_PHASES.length; i++) {
        phases.push(ORDER_EXPORT_PHASES[i]);
    }
    return phases;
}

function buildStatusFilters(values) {
    var filters = [{ value: '', key: 'all' }];
    for (var i = 0; i < values.length; i++) {
        filters.push({
            value: values[i],
            key:   values[i].toLowerCase()
        });
    }
    return filters;
}

function getCtpOrderStateFilters() {
    return buildStatusFilters(CTP_ORDER_STATE_VALUES);
}

function getCtpPaymentStateFilters() {
    return buildStatusFilters(CTP_PAYMENT_STATE_VALUES);
}

function isValidCtpOrderState(value) {
    return !value || CTP_ORDER_STATE_VALUES.indexOf(value) >= 0;
}

function isValidCtpPaymentState(value) {
    return !value || CTP_PAYMENT_STATE_VALUES.indexOf(value) >= 0;
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
    getOrderExportPhases:   getOrderExportPhases,
    getCtpOrderStateFilters:   getCtpOrderStateFilters,
    getCtpPaymentStateFilters: getCtpPaymentStateFilters,
    isValidCtpOrderState:      isValidCtpOrderState,
    isValidCtpPaymentState:    isValidCtpPaymentState,
    getDataTypes:           getDataTypes,
    getDataType:            getDataType,
    buildDataSelectContent: buildDataSelectContent
};
