'use strict';

var WIZARD_STEPS = [
    { id: 1, key: 'connect', label: 'Connect' },
    { id: 2, key: 'fetch',   label: 'Fetch' },
    { id: 3, key: 'aimap',  label: 'AI Map' },
    { id: 4, key: 'move',   label: 'Move' },
    { id: 5, key: 'view',   label: 'View' }
];

var PLATFORMS = [
    {
        id:          'commercetools',
        name:        'commercetools',
        tagline:     'API-first, Business Units, Headless',
        status:      'ready',
        confidence:  75,
        featured:    true,
        description: 'Migrate commercetools customers, products, categories, orders, and price lists into Salesforce B2B Commerce, mapping catalogs/pricing models with moderate transformation and extensions.',
        iconClass:   'platform-icon--commercetools',
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
        id:          'shopify',
        name:        'Shopify Plus',
        tagline:     'B2B, Markets, Headless',
        status:      'ready',
        confidence:  92,
        description: 'Migrate Shopify Plus customers, products, collections, orders, and price lists into Salesforce B2B Commerce with high-confidence field mapping.',
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
        tagline:     'B2B Edition, Multi-store',
        status:      'ready',
        confidence:  88,
        description: 'Migrate BigCommerce B2B customers, catalog, categories, orders, and contract pricing into Salesforce B2B Commerce.',
        iconClass:   'platform-icon--bigcommerce',
        connectHint: 'Provide your BigCommerce store hash and API credentials.',
        connectFields: [
            { name: 'storeHash',   label: 'Store hash',   type: 'text',     required: true, value: '' },
            { name: 'clientId',    label: 'Client ID',    type: 'text',     required: true, value: '' },
            { name: 'accessToken', label: 'Access token', type: 'password', required: true, value: '' }
        ]
    },
    {
        id:          'sfcc',
        name:        'Salesforce B2C',
        tagline:     'SFRA, Page Designer',
        status:      'soon',
        confidence:  0,
        description: 'Cross-cloud migration from B2C Commerce to B2B Commerce (planned).',
        iconClass:   'platform-icon--salesforce',
        connectHint: '',
        connectFields: []
    },
    {
        id:          'sap',
        name:        'SAP Commerce',
        tagline:     'B2B, OCC, Integrations',
        status:      'soon',
        confidence:  0,
        description: 'SAP Commerce Cloud to Salesforce B2B Commerce migration path (planned).',
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

function getNextStepLabel(currentStep) {
    var stepNum = parseInt(String(currentStep), 10) || 1;
    if (stepNum >= WIZARD_STEPS.length) return 'Finish';
    return 'Continue to ' + WIZARD_STEPS[stepNum].label;
}

module.exports = {
    getPlatform:      getPlatform,
    getPlatforms:     getPlatforms,
    getWizardSteps:   getWizardSteps,
    getWizardStep:    getWizardStep,
    getNextStepLabel: getNextStepLabel,
    maxStep:          WIZARD_STEPS.length
};
