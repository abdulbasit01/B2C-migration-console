'use strict';

var migCfg = require('*/cartridge/scripts/migration/config');

var WIZARD_STEPS = [
    { id: 1, key: 'connect', label: 'Connect' },
    { id: 2, key: 'fetch', label: 'Fetch' },
    { id: 3, key: 'aimap', label: 'AI Map' },
    { id: 4, key: 'move', label: 'Move' },
    { id: 5, key: 'view', label: 'View' }
];

var PLATFORMS = [
    {
        id: 'commercetools',
        name: 'commercetools',
        tagline: 'API-first, Business Units, Headless',
        status: 'ready',
        confidence: 75,
        featured: true,
        description: 'Migrate commercetools customers, products, categories, and inventory into Salesforce B2C Commerce via OCAPI.',
        iconClass: 'platform-icon--commercetools',
        connectHint: 'Credentials are pre-loaded from your project configuration.',
        connectFields: [
            { name: 'projectKey',   label: 'Project key',   type: 'text',     required: true,  value: migCfg.ctp.projectKey },
            { name: 'clientId',     label: 'Client ID',     type: 'text',     required: true,  value: migCfg.ctp.clientId },
            { name: 'clientSecret', label: 'Client secret', type: 'password', required: true,  value: '••••••••' },
            { name: 'apiUrl',       label: 'API URL',       type: 'text',     required: true,  value: migCfg.ctp.apiUrl },
            { name: 'scopes',       label: 'Scopes',        type: 'text',     required: false, value: migCfg.ctp.scopes }
        ]
    },
    {
        id: 'shopify',
        name: 'Shopify Plus',
        tagline: 'B2B, Markets, Headless',
        status: 'ready',
        confidence: 92,
        description: 'Migrate Shopify Plus customers, products, collections, orders, and price lists into Salesforce B2B Commerce with high-confidence field mapping.',
        iconClass: 'platform-icon--shopify',
        connectHint: 'Enter your Shopify store URL and Admin API access token.',
        connectFields: [
            { name: 'storeUrl',    label: 'Store URL',        type: 'text',     required: true,  value: 'https://your-store.myshopify.com' },
            { name: 'accessToken', label: 'API access token', type: 'password', required: true,  value: '' },
            { name: 'apiVersion',  label: 'API version',      type: 'text',     required: false, value: '2025-01' }
        ]
    },
    {
        id: 'bigcommerce',
        name: 'BigCommerce',
        tagline: 'B2B Edition, Multi-store',
        status: 'ready',
        confidence: 88,
        description: 'Migrate BigCommerce B2B customers, catalog, categories, orders, and contract pricing into Salesforce B2B Commerce.',
        iconClass: 'platform-icon--bigcommerce',
        connectHint: 'Provide your BigCommerce store hash and API credentials.',
        connectFields: [
            { name: 'storeHash',   label: 'Store hash',   type: 'text',     required: true, value: '' },
            { name: 'clientId',    label: 'Client ID',    type: 'text',     required: true, value: '' },
            { name: 'accessToken', label: 'Access token', type: 'password', required: true, value: '' }
        ]
    },
    {
        id: 'sfcc',
        name: 'Salesforce B2C',
        tagline: 'SFRA, Page Designer',
        status: 'soon',
        confidence: 0,
        description: 'Cross-cloud migration from B2C Commerce to B2B Commerce (planned).',
        iconClass: 'platform-icon--salesforce',
        connectHint: '',
        connectFields: []
    },
    {
        id: 'sap',
        name: 'SAP Commerce',
        tagline: 'B2B, OCC, Integrations',
        status: 'soon',
        confidence: 0,
        description: 'SAP Commerce Cloud to Salesforce B2B Commerce migration path (planned).',
        iconClass: 'platform-icon--sap',
        connectHint: '',
        connectFields: []
    }
];

var STEP_CONTENT = {
    fetch: {
        titleSuffix: 'Fetch source data',
        intro: 'Select entities to pull from the source platform. This is a preview — no live API calls are made.',
        sections: [
            { title: 'Catalog', items: ['Products (12,450)', 'Categories (186)', 'Product types (24)', 'Price lists (8)'] },
            { title: 'Customers & orders', items: ['Business units (42)', 'Customers (3,210)', 'Orders (18,902)', 'Quotes (1,104)'] }
        ],
        summary: 'Estimated payload: ~2.4 GB · ~45 min fetch (demo)'
    },
    aimap: {
        titleSuffix: 'AI field mapping',
        intro: 'Review AI-suggested mappings from source to Salesforce B2B Commerce. Adjust before import.',
        mappings: [
            { source: 'product.key',                     target: 'Product.ID',           confidence: 98 },
            { source: 'product.masterData.current.name', target: 'Product.name',         confidence: 95 },
            { source: 'category.key',                    target: 'Category.ID',          confidence: 97 },
            { source: 'customer.email',                  target: 'Profile.email',        confidence: 99 },
            { source: 'order.orderNumber',               target: 'Order.orderNo',        confidence: 96 },
            { source: 'standalonePrice.value',           target: 'PriceBookEntry.price', confidence: 72 }
        ]
    },
    move: {
        titleSuffix: 'Run migration',
        intro: 'Execute the import job. Progress updates when the page refreshes.',
        phases: [
            { name: 'Validate mappings', status: 'done',    pct: 100 },
            { name: 'Import catalog',    status: 'active',  pct: 62  },
            { name: 'Import customers',  status: 'pending', pct: 0   },
            { name: 'Import inventory',  status: 'pending', pct: 0   }
        ]
    },
    view: {
        titleSuffix: 'Migration summary',
        intro: 'Review results and next steps.',
        stats: [
            { label: 'Products imported',   value: '—' },
            { label: 'Categories imported', value: '—' },
            { label: 'Customers imported',  value: '—' },
            { label: 'Inventory imported',  value: '—' }
        ]
    }
};

/**
 * @param {string} platformId - platform id
 * @returns {Object|null} platform object or null
 */
function getPlatform(platformId) {
    var id = platformId || '';
    for (var i = 0; i < PLATFORMS.length; i++) {
        if (PLATFORMS[i].id === id) return PLATFORMS[i];
    }
    return null;
}

/**
 * @returns {Array} all platforms
 */
function getPlatforms() {
    return PLATFORMS;
}

/**
 * @returns {Array} all wizard steps
 */
function getWizardSteps() {
    return WIZARD_STEPS;
}

/**
 * @param {number} step - step number 1-5
 * @returns {Object} wizard step object
 */
function getWizardStep(step) {
    var stepNum = Math.min(Math.max(parseInt(step, 10) || 1, 1), WIZARD_STEPS.length);
    return WIZARD_STEPS[stepNum - 1];
}

/**
 * @param {string} stepKey - connect|fetch|aimap|move|view
 * @returns {Object|null} step content or null
 */
function getStepContent(stepKey) {
    if (stepKey === 'connect') return null;
    return STEP_CONTENT[stepKey] || null;
}

/**
 * @param {number} currentStep - current step number
 * @returns {string} label for next step button
 */
function getNextStepLabel(currentStep) {
    var stepNum = parseInt(currentStep, 10) || 1;
    if (stepNum >= WIZARD_STEPS.length) return 'Finish';
    return 'Continue to ' + WIZARD_STEPS[stepNum].label;
}

module.exports = {
    getPlatform:      getPlatform,
    getPlatforms:     getPlatforms,
    getWizardSteps:   getWizardSteps,
    getWizardStep:    getWizardStep,
    getStepContent:   getStepContent,
    getNextStepLabel: getNextStepLabel,
    maxStep:          WIZARD_STEPS.length
};
