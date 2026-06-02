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
        id: 'commercetools',
        name: 'commercetools',
        tagline: 'API-first, Business Units, Headless',
        status: 'ready',
        confidence: 75,
        featured: true,
        description: 'Migrate commercetools customers, products, categories, orders, and price lists into Salesforce B2B Commerce, mapping catalogs/pricing models with moderate transformation and extensions.',
        iconClass: 'platform-icon--commercetools',
        connectHint: 'Credentials are pre-loaded from your project configuration.',
        connectFields: [
            { name: 'projectKey',   label: 'Project key',   type: 'text',     required: true,  value: '' },
            { name: 'clientId',     label: 'Client ID',     type: 'text',     required: true,  value: '' },
            { name: 'clientSecret', label: 'Client secret', type: 'password', required: true,  value: '' },
            { name: 'apiUrl',       label: 'API URL',       type: 'text',     required: true,  value: '' },
            { name: 'scopes',       label: 'Scopes',        type: 'text',     required: false, value: '' }
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
        titleSuffix: 'Fetch source schema',
        intro:       'Live schema counts from your commercetools project.',
        sections: [
            { title: 'Product Schema',  items: ['Product types', 'Product attributes'] },
            { title: 'Custom Types',    items: ['Custom types', 'Custom fields'] }
        ],
        summary: 'Counts load live from CTP when you reach this step.'
    },
    aimap: {
        titleSuffix: 'Schema field mapping',
        intro:       'CTP attribute types → SFCC attribute value_type mappings used during migration.',
        mappings: [
            { source: 'ProductType.text',            target: 'Product → string',              confidence: 100 },
            { source: 'ProductType.ltext',           target: 'Product → string',              confidence: 100 },
            { source: 'ProductType.enum / lenum',    target: 'Product → string',              confidence: 100 },
            { source: 'ProductType.number',          target: 'Product → double',              confidence: 100 },
            { source: 'ProductType.boolean',         target: 'Product → boolean',             confidence: 100 },
            { source: 'ProductType.date',            target: 'Product → date',                confidence: 100 },
            { source: 'ProductType.datetime',        target: 'Product → datetime',            confidence: 100 },
            { source: 'ProductType.money',           target: 'Product → double',              confidence: 95  },
            { source: 'ProductType.reference',       target: 'Product → string',              confidence: 90  },
            { source: 'CustomType(customer)',        target: 'Customer → (matched type)',     confidence: 98  },
            { source: 'CustomType(order)',           target: 'Order → (matched type)',        confidence: 98  },
            { source: 'CustomType(shopping-list)',   target: 'ProductList → (matched type)',  confidence: 97  },
            { source: 'CustomType(inventory-entry)', target: 'ProductInventoryRecord → ...',  confidence: 97  },
            { source: 'CustomType(cart-discount)',   target: 'Promotion → (matched type)',    confidence: 95  }
        ]
    },
    move: {
        titleSuffix: 'Run schema migration',
        intro:       'Creating SFCC attribute definitions from CTP schema. Existing attributes are skipped.',
        phases: [
            { name: 'Product',                status: 'pending', pct: 0 },
            { name: 'Category + Customer',    status: 'pending', pct: 0 },
            { name: 'Order + Inventory',      status: 'pending', pct: 0 },
            { name: 'ProductList + Promotion', status: 'pending', pct: 0 }
        ]
    },
    view: {
        titleSuffix: 'Schema migration summary',
        intro:       'Attribute definitions created in SFCC system objects.',
        stats: [
            { label: 'Product attributes',               value: '—' },
            { label: 'Customer attributes',              value: '—' },
            { label: 'Order attributes',                 value: '—' },
            { label: 'ProductInventoryRecord attributes', value: '—' }
        ]
    }
};

/**
 * Merge generated CTP credentials into commercetools connect fields.
 * @param {Object} platform - platform definition
 * @returns {Object} platform clone with connect field values applied
 */
function withCtpCredentials(platform) {
    if (!platform || platform.id !== 'commercetools') {
        return platform;
    }

    var migCfg;
    try {
        migCfg = require('*/cartridge/scripts/migration/configAccessor');
    } catch (e) {
        return platform;
    }

    var ctp = migCfg.ctp || {};
    var clone = {
        id:            platform.id,
        name:          platform.name,
        tagline:       platform.tagline,
        status:        platform.status,
        confidence:    platform.confidence,
        featured:      platform.featured,
        description:   platform.description,
        iconClass:     platform.iconClass,
        connectHint:   platform.connectHint,
        connectFields: []
    };
    var fields = platform.connectFields || [];
    var i;

    for (i = 0; i < fields.length; i++) {
        var field = fields[i];
        var value = field.value;

        if (field.name === 'projectKey') {
            value = ctp.projectKey || value;
        } else if (field.name === 'clientId') {
            value = ctp.clientId || value;
        } else if (field.name === 'clientSecret' && ctp.clientSecret) {
            value = '••••••••';
        } else if (field.name === 'apiUrl') {
            value = ctp.apiUrl || value;
        } else if (field.name === 'scopes') {
            value = ctp.scopes || value;
        }

        clone.connectFields.push({
            name:     field.name,
            label:    field.label,
            type:     field.type,
            required: field.required,
            value:    value
        });
    }

    return clone;
}

/**
 * @param {string} platformId - platform id
 * @returns {Object|null} platform object or null
 */
function getPlatform(platformId) {
    var id = platformId || '';
    var i;

    for (i = 0; i < PLATFORMS.length; i++) {
        if (PLATFORMS[i].id === id) {
            return withCtpCredentials(PLATFORMS[i]);
        }
    }
    return null;
}

/**
 * @returns {Array} all platforms
 */
function getPlatforms() {
    var list = [];
    var seen = {};
    var i;

    for (i = 0; i < PLATFORMS.length; i++) {
        var platform = PLATFORMS[i];
        if (seen[platform.id]) {
            continue;
        }
        seen[platform.id] = true;
        list.push(withCtpCredentials(platform));
    }
    return list;
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
