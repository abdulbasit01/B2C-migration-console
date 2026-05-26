'use strict';

var WIZARD_STEPS = [
    { id: 1, key: 'connect', label: 'Connect' },
    { id: 2, key: 'fetch', label: 'Fetch' },
    { id: 3, key: 'aimap', label: 'AI Map' },
    { id: 4, key: 'move', label: 'Move' },
    { id: 5, key: 'view', label: 'View' }
];

var PLATFORMS = [
    {
        id: 'shopify',
        name: 'Shopify Plus',
        tagline: 'B2B, Markets, Headless',
        status: 'ready',
        confidence: 92,
        description: 'Migrate Shopify Plus customers, products, collections, orders, and price lists into Salesforce B2B Commerce with high-confidence field mapping.',
        iconClass: 'platform-icon--shopify',
        connectHint: 'Enter your Shopify store URL and Admin API access token. We\'ll verify with a single shop.json call.',
        connectFields: [
            { name: 'storeUrl', label: 'Store URL', type: 'text', required: true, value: 'https://rci-b2b-mig-demo.myshopify.com' },
            { name: 'accessToken', label: 'API access token', type: 'password', required: true, value: 'shpat_demo_token_placeholder' },
            { name: 'apiVersion', label: 'API version', type: 'text', required: false, value: '2025-01' }
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
        connectHint: 'Provide your BigCommerce store hash and API credentials for catalog and order export.',
        connectFields: [
            { name: 'storeHash', label: 'Store hash', type: 'text', required: true, value: 'abc123store' },
            { name: 'clientId', label: 'Client ID', type: 'text', required: true, value: 'bc_client_demo' },
            { name: 'accessToken', label: 'Access token', type: 'password', required: true, value: 'bc_token_demo' }
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
        id: 'commercetools',
        name: 'commercetools',
        tagline: 'API-first, Business Units, Headless',
        status: 'ready',
        confidence: 75,
        description: 'Migrate commercetools customers, products, categories, orders, and price lists into Salesforce B2B Commerce, mapping catalogs/pricing models with moderate transformation and extensions.',
        iconClass: 'platform-icon--commercetools',
        connectHint: 'Enter your commercetools project credentials. We\'ll verify with a lightweight project settings call.',
        connectFields: [
            { name: 'projectKey', label: 'Project key', type: 'text', required: true, value: 'rc-b2b-migration-demo' },
            { name: 'clientId', label: 'Client ID', type: 'text', required: true, value: 'ct_client_demo' },
            { name: 'clientSecret', label: 'Client secret', type: 'password', required: true, value: 'ct_secret_demo' },
            { name: 'apiUrl', label: 'API URL', type: 'text', required: true, value: 'https://api.us-central1.gcp.commercetools.com' },
            { name: 'scopes', label: 'Scopes', type: 'text', required: false, value: 'manage_project:rc-b2b-migration-demo' }
        ]
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
            { source: 'product.key', target: 'Product.ID', confidence: 98 },
            { source: 'product.masterData.current.name', target: 'Product.name', confidence: 95 },
            { source: 'category.key', target: 'Category.ID', confidence: 97 },
            { source: 'customer.email', target: 'Profile.email', confidence: 99 },
            { source: 'order.orderNumber', target: 'Order.orderNo', confidence: 96 },
            { source: 'standalonePrice.value', target: 'PriceBookEntry.price', confidence: 72 }
        ]
    },
    move: {
        titleSuffix: 'Run migration',
        intro: 'Execute the import job (simulated). Progress below is static demo data.',
        phases: [
            { name: 'Validate mappings', status: 'done', pct: 100 },
            { name: 'Import catalog', status: 'active', pct: 62 },
            { name: 'Import customers', status: 'pending', pct: 0 },
            { name: 'Import orders', status: 'pending', pct: 0 }
        ]
    },
    view: {
        titleSuffix: 'Migration summary',
        intro: 'Review results and next steps. All figures are placeholder demo values.',
        stats: [
            { label: 'Products imported', value: '12,450' },
            { label: 'Categories imported', value: '186' },
            { label: 'Customers imported', value: '3,210' },
            { label: 'Orders imported', value: '18,902' },
            { label: 'Warnings', value: '23' },
            { label: 'Errors', value: '0' }
        ]
    }
};

/**
 * @param {string} platformId - platform id
 * @returns {Object|null}
 */
function getPlatform(platformId) {
    var id = platformId || '';
    var platforms = PLATFORMS;
    for (var i = 0; i < platforms.length; i++) {
        if (platforms[i].id === id) {
            return platforms[i];
        }
    }
    return null;
}

/**
 * @returns {Array}
 */
function getPlatforms() {
    return PLATFORMS;
}

/**
 * @returns {Array}
 */
function getWizardSteps() {
    return WIZARD_STEPS;
}

/**
 * @param {number} step - 1-5
 * @returns {Object|null}
 */
function getWizardStep(step) {
    var steps = WIZARD_STEPS;
    var stepNum = parseInt(step, 10) || 1;
    if (stepNum < 1) {
        stepNum = 1;
    }
    if (stepNum > steps.length) {
        stepNum = steps.length;
    }
    return steps[stepNum - 1];
}

/**
 * @param {string} stepKey - connect|fetch|aimap|move|view
 * @returns {Object|null}
 */
function getStepContent(stepKey) {
    if (stepKey === 'connect') {
        return null;
    }
    return STEP_CONTENT[stepKey] || null;
}

/**
 * @param {number} currentStep - 1-5
 * @returns {string}
 */
function getNextStepLabel(currentStep) {
    var steps = WIZARD_STEPS;
    var stepNum = parseInt(currentStep, 10) || 1;
    if (stepNum >= steps.length) {
        return 'Finish';
    }
    return 'Continue to ' + steps[stepNum].label;
}

module.exports = {
    getPlatform: getPlatform,
    getPlatforms: getPlatforms,
    getWizardSteps: getWizardSteps,
    getWizardStep: getWizardStep,
    getStepContent: getStepContent,
    getNextStepLabel: getNextStepLabel,
    maxStep: WIZARD_STEPS.length
};
