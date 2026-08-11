'use strict';

/**
 * SAP Commerce Cloud (Hybris) connector — OCC v2 REST API.
 * Phase 1 scope: Product only (see migration plan). Other tasks are registered
 * in TASK_ORDER for forward-compatibility but currently report zero fields —
 * they will gain real schema discovery in later phases (Customer, Order, ...).
 */

var sapApi  = require('*/cartridge/scripts/migration/core/sapApi');
var typeMap = require('*/cartridge/scripts/migration/connectors/sap/sapTypeMap');
var transformer = require('*/cartridge/scripts/migration/connectors/sap/sapTransformer');
var cfg     = require('*/cartridge/scripts/migration/configAccessor');

// ─── Standard fields per task (fixed schema, mirrors Shopify's approach) ──────

var STANDARD_PRODUCT_FIELDS = [
    { key: 'code',        type: 'java.lang.String',     label: 'Code' },
    { key: 'name',        type: 'localized',            label: 'Name' },
    { key: 'summary',     type: 'localized',             label: 'Summary' },
    { key: 'description', type: 'localized',             label: 'Description' },
    { key: 'manufacturer', type: 'java.lang.String',     label: 'Manufacturer' },
    { key: 'ean',          type: 'java.lang.String',     label: 'EAN' },
    { key: 'approvalStatus', type: 'java.lang.String',   label: 'Approval Status' }
];

var TASK_STANDARD_FIELDS = {
    Product:                STANDARD_PRODUCT_FIELDS,
    Category:               [],
    Customer:                [],
    Order:                   [],
    ProductInventoryRecord:  [],
    CustomerGroup:           []
};

// Phase 1: only Product is offered by default. Other tasks are planned (see plan doc).
var TASK_ORDER = ['Product'];

var TASK_TITLES = {
    Product:                'Product',
    Category:               'Category',
    Customer:               'Customer / Profile',
    Order:                  'Order',
    ProductInventoryRecord: 'Inventory Record',
    CustomerGroup:          'Customer Group'
};

function validateCreds(creds) {
    sapApi.getCreds(creds);
}

function fmt(n) {
    return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ─── Connection test ──────────────────────────────────────────────────────────

function testConnectionWith(creds) {
    if (!creds.baseUrl || !creds.baseSite) {
        throw new Error('Base URL and Base Site are required.');
    }
    sapApi.getAccessToken(creds);
    var res = sapApi.get('/products/search?pageSize=1', creds);
    return {
        ok:        true,
        expiresIn: 3599,
        project:   { key: creds.baseSite, name: 'SAP Commerce (' + creds.baseSite + ')' }
    };
}

function testConnection() {
    return testConnectionWith(cfg.sap);
}

// ─── Schema counts ────────────────────────────────────────────────────────────

function getSchemaCounts() {
    var c = cfg.sap;
    validateCreds(c);

    var standardTotal = 0;
    for (var ti = 0; ti < TASK_ORDER.length; ti++) {
        standardTotal += (TASK_STANDARD_FIELDS[TASK_ORDER[ti]] || []).length;
    }

    return {
        standardTotal: standardTotal,
        metafieldDefs: 0,
        byResource:    {}
    };
}

// ─── Attribute definitions ────────────────────────────────────────────────────

function getAttrDefsForTask(task) {
    var stdFields = TASK_STANDARD_FIELDS[task] || [];
    var seen      = {};
    var defs      = [];

    function push(def) {
        if (!seen[def.id]) { seen[def.id] = true; defs.push(def); }
    }

    for (var sf = 0; sf < stdFields.length; sf++) {
        push(transformer.transformStandardField(stdFields[sf]));
    }

    return defs;
}

function getAttrIdsForTask(task) {
    var defs = getAttrDefsForTask(task);
    var ids  = [];
    for (var i = 0; i < defs.length; i++) ids.push(defs[i].id);
    return ids;
}

// ─── Fetch step content (Step 2) ──────────────────────────────────────────────

function buildFetchContent(counts) {
    var sections    = [];
    var totalFields = 0;

    for (var ti = 0; ti < TASK_ORDER.length; ti++) {
        var task     = TASK_ORDER[ti];
        var stdCount = (TASK_STANDARD_FIELDS[task] || []).length;
        totalFields += stdCount;

        sections.push({ taskId: task, title: TASK_TITLES[task], items: ['Standard fields'], selectable: true });
    }

    return {
        titleSuffix: 'Select schemas to migrate',
        intro:       'Standard OCC Product fields are always included. Additional modules (Customer, Order, Catalog, ...) are planned for later phases.',
        sections:    sections,
        summary:     'Total schema definitions: ' + fmt(totalFields)
    };
}

// ─── AI Map step content (Step 3) ────────────────────────────────────────────

function toGroup(title, mappings) {
    var existsCount = 0;
    for (var i = 0; i < mappings.length; i++) { if (mappings[i].exists) existsCount++; }
    return { title: title, total: mappings.length, existsCount: existsCount, newCount: mappings.length - existsCount, mappings: mappings };
}

function buildAiMapContent(selectedTasks, existingByTask) {
    var existing   = existingByTask || {};
    var groups     = [];
    var totalAttrs = 0;

    for (var ti = 0; ti < TASK_ORDER.length; ti++) {
        var task = TASK_ORDER[ti];
        if (selectedTasks && selectedTasks.indexOf(task) < 0) continue;

        var mappings  = [];
        var stdFields = TASK_STANDARD_FIELDS[task] || [];

        for (var sf = 0; sf < stdFields.length; sf++) {
            var std = stdFields[sf];
            totalAttrs++;
            mappings.push({
                source:      std.key + ' (' + std.type + ')',
                attributeId: std.key,
                target:      typeMap.resolveAttributeType(std.type),
                confidence:  typeMap.confidence(std.type),
                exists:      !!(existing[task] && existing[task][std.key])
            });
        }

        if (mappings.length) groups.push(toGroup(TASK_TITLES[task], mappings));
    }

    return {
        titleSuffix: 'Schema field mapping',
        intro:       'SAP Commerce field → SFCC value_type mappings. ' + totalAttrs + ' total attribute(s) across ' + groups.length + ' entity type(s).',
        groups:      groups
    };
}

// ─── Credential injection (for migrationData connect form pre-fill) ───────────

function injectCredentials(fields) {
    var s   = cfg.sap || {};
    var out = [];
    for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        var value = field.value;
        if (field.name === 'baseUrl')                        value = s.baseUrl    || value;
        else if (field.name === 'baseSite')                  value = s.baseSite   || value;
        else if (field.name === 'clientId')                  value = s.clientId   || value;
        else if (field.name === 'clientSecret' && s.clientSecret) value = '••••••••';
        out.push({ name: field.name, label: field.label, type: field.type, required: field.required, value: value, placeholder: field.placeholder || '' });
    }
    return out;
}

// ─── Default tasks ────────────────────────────────────────────────────────────

function getDefaultTasks() {
    return TASK_ORDER.slice();
}

// ─── Public interface ─────────────────────────────────────────────────────────

module.exports = {
    id:                  'sap',
    testConnectionWith:  testConnectionWith,
    testConnection:      testConnection,
    getSchemaCounts:     getSchemaCounts,
    getAttrDefsForTask:  getAttrDefsForTask,
    getAttrIdsForTask:   getAttrIdsForTask,
    injectCredentials:   injectCredentials,
    getDefaultTasks:     getDefaultTasks,
    buildFetchContent:   buildFetchContent,
    buildAiMapContent:   buildAiMapContent
};
