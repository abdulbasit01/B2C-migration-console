'use strict';

/* global request, response, session */

/* eslint-disable no-var */

var ISML     = require('dw/template/ISML');
var URLUtils = require('dw/web/URLUtils');
var Resource = require('dw/web/Resource');

// Lazy-loaded inside functions per Prophet best practice, but cached here for performance
var migrationData = require('*/cartridge/scripts/accelerator/migrationData'); // eslint-disable-line prophet/no-global-require
var ctpClient     = require('*/cartridge/scripts/migration/ctpClient');        // eslint-disable-line prophet/no-global-require
var typeMap       = require('*/cartridge/scripts/migration/typeMap');           // eslint-disable-line prophet/no-global-require

/**
 * Format number with commas.
 * @param {number} n - number
 * @returns {string} formatted string
 */
function fmt(n) {
    return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* CTP resourceTypeIds that belong to each runner task */
var TASK_RESOURCES = {
    Product:                ['product', 'product-variant', 'product-price'],
    Category:               ['category'],
    Customer:               ['customer'],
    Order:                  ['order', 'order-edit', 'line-item', 'custom-line-item', 'cart', 'payment', 'payment-interface-interaction'],
    ProductInventoryRecord: ['inventory-entry'],
    ProductList:            ['shopping-list'],
    ProductListItem:        ['shopping-list-text-line-item'],
    Promotion:              ['cart-discount', 'discount-code']
};

var TASK_LABELS = {
    Product:                'Product',
    Category:               'Category',
    Customer:               'Customer',
    Order:                  'Order',
    ProductInventoryRecord: 'Product Inventory Record',
    ProductList:            'Product List',
    ProductListItem:        'Product List Item',
    Promotion:              'Promotion'
};

var RESOURCE_LABEL_MAP = {
    'address':         'Address',
    'store':           'Store',
    'customer-group':  'Customer Group',
    'channel':         'Channel',
    'review':          'Review',
    'asset':           'Asset',
    'shipping':        'Shipping',
    'shipping-method': 'Shipping Method'
};

/**
 * Build Fetch step content grouped by SFCC runner task.
 * @param {Object} counts - schema counts from ctpClient.getSchemaCounts()
 * @returns {Object} stepContent for stepFetch.isml
 */
function buildFetchContent(counts) {
    var byResource  = counts.byResource || {};
    var sections    = [];
    var totalFields = (counts.productAttributes || 0) + (counts.customFields || 0);
    var taskNames   = Object.keys(TASK_RESOURCES);
    var knownRids   = [];
    var t;
    var r;

    for (t = 0; t < taskNames.length; t++) {
        var task      = taskNames[t];
        var resources = TASK_RESOURCES[task];
        var items     = [];
        var ctCount   = 0;
        var cfCount   = 0;

        if (task === 'Product') {
            items.push('Product types (' + fmt(counts.productTypes) + ')');
            items.push('Product attributes (' + fmt(counts.productAttributes) + ')');
        }

        for (r = 0; r < resources.length; r++) {
            var rid = resources[r];
            knownRids.push(rid);
            if (byResource[rid]) {
                ctCount += byResource[rid].types;
                cfCount += byResource[rid].fields;
            }
        }

        if (ctCount > 0) {
            items.push('Custom types (' + fmt(ctCount) + ')');
            items.push('Custom fields (' + fmt(cfCount) + ')');
        }

        if (!items.length) continue;

        sections.push({
            taskId:      task,
            title:       TASK_LABELS[task],
            items:       items,
            selectable:  true
        });
    }

    // Non-runner resources — informational only
    var otherItems  = [];
    var rids        = Object.keys(byResource);
    for (var i = 0; i < rids.length; i++) {
        if (knownRids.indexOf(rids[i]) < 0) {
            var lbl = RESOURCE_LABEL_MAP[rids[i]] || rids[i];
            otherItems.push(lbl + ': ' + fmt(byResource[rids[i]].types) + ' type(s), ' + fmt(byResource[rids[i]].fields) + ' field(s)');
        }
    }

    if (otherItems.length) {
        sections.push({ taskId: null, title: 'Not Supported in This Migration', items: otherItems, selectable: false });
    }

    return {
        titleSuffix: 'Select schemas to migrate',
        intro:       'Choose which schemas to include. All are selected by default.',
        sections:    sections,
        summary:     'Total schema definitions: ' + fmt(totalFields)
    };
}

/**
 * Resolve CTP attribute type → confidence score.
 * @param {string} ctpType
 * @returns {number} confidence 0-100
 */
function attrConfidence(ctpType) {
    var perfect = ['text', 'ltext', 'boolean', 'date', 'datetime', 'number', 'String', 'LocalizedString', 'Boolean', 'Date', 'DateTime', 'Number', 'Integer'];
    var high    = ['enum', 'lenum', 'time', 'Enum', 'LocalizedEnum', 'Time'];
    var med     = ['money', 'reference', 'Money', 'Reference'];
    if (perfect.indexOf(ctpType) >= 0) return 100;
    if (high.indexOf(ctpType) >= 0) return 98;
    if (med.indexOf(ctpType) >= 0) return 95;
    return 90;
}

/**
 * Build AI Map step content grouped by SFCC object type.
 * @param {Array}      productTypes   - CTP ProductType array
 * @param {Array}      customTypes    - CTP Custom Type array
 * @param {Array|null}  selectedTasks  - runner task names to include (null = all)
 * @param {Object|null} existingByTask - { taskName: { attrId: true } } from SFCC
 * @returns {Object} stepContent for stepAiMap.isml
 */
function buildAiMapContent(productTypes, customTypes, selectedTasks, existingByTask) {
    var existing = existingByTask || {};
    var groups     = [];
    var seen       = {};
    var totalAttrs = 0;
    var i;
    var j;

    // --- Product group ---
    var showProduct = !selectedTasks || selectedTasks.indexOf('Product') >= 0;
    var productMappings = [];
    for (i = 0; i < productTypes.length; i++) {
        var attrs = productTypes[i].attributes || [];
        totalAttrs += attrs.length;
        if (!showProduct) continue;
        for (j = 0; j < attrs.length; j++) {
            var attr    = attrs[j];
            var key     = 'product__' + attr.name;
            if (seen[key]) continue;
            seen[key]   = true;
            var ctpType = attr.type && attr.type.name ? attr.type.name : 'text';
            productMappings.push({
                source:     attr.name + ' (' + ctpType + ')',
                target:     'Product → ' + typeMap.resolveProductAttrType(ctpType),
                confidence: attrConfidence(ctpType),
                exists:     !!(existing.Product && existing.Product[attr.name])
            });
        }
    }
    // --- Custom type groups by SFCC object type ---
    var GROUP_ORDER  = ['Category', 'Customer', 'Order', 'ProductInventoryRecord', 'ProductList', 'ProductListItem', 'Promotion', 'Profile', 'SitePreferences', 'CustomerGroup'];
    var customGroups = {};

    for (i = 0; i < customTypes.length; i++) {
        var ct              = customTypes[i];
        var resourceTypeIds = ct.resourceTypeIds || [];
        var fields          = ct.fieldDefinitions || [];
        totalAttrs         += fields.length;

        var sfccObj = null;
        for (var r = 0; r < resourceTypeIds.length; r++) {
            var resolved = typeMap.resolveSFCCObjectType(resourceTypeIds[r]);
            if (resolved) { sfccObj = resolved; break; }
        }
        if (!sfccObj) continue;

        // Check if this SFCC object type is in the selected runner tasks.
        // Map sfccObj back to runner task name (Profile→Customer, SitePreferences→skipped etc.)
        var runnerTask = sfccObj;
        if (runnerTask === 'Profile') runnerTask = 'Customer';
        if (selectedTasks && selectedTasks.indexOf(runnerTask) < 0) continue;

        if (!customGroups[sfccObj]) customGroups[sfccObj] = [];

        for (j = 0; j < fields.length; j++) {
            var field = fields[j];
            var fkey  = sfccObj + '__' + field.name;
            if (seen[fkey]) continue;
            seen[fkey] = true;
            var fType  = field.type && field.type.name ? field.type.name : 'String';
            customGroups[sfccObj].push({
                source:     field.name + ' (' + fType + ')',
                target:     sfccObj + ' → ' + typeMap.resolveCustomFieldType(fType),
                confidence: attrConfidence(fType),
                exists:     !!(existing[sfccObj] && existing[sfccObj][field.name])
            });
        }
    }

    // Merge custom-type fields that resolve to 'Product' into the main product group
    if (customGroups['Product']) {
        for (var pm = 0; pm < customGroups['Product'].length; pm++) {
            productMappings.push(customGroups['Product'][pm]);
        }
        delete customGroups['Product'];
    }
    if (productMappings.length) {
        var pExists = 0;
        for (var pe = 0; pe < productMappings.length; pe++) { if (productMappings[pe].exists) pExists++; }
        groups.push({ title: 'Product', total: productMappings.length, existsCount: pExists, newCount: productMappings.length - pExists, mappings: productMappings });
    }

    for (var g = 0; g < GROUP_ORDER.length; g++) {
        var gKey = GROUP_ORDER[g];
        if (customGroups[gKey] && customGroups[gKey].length) {
            var gm = customGroups[gKey];
            var gEx = 0;
            for (var ge = 0; ge < gm.length; ge++) { if (gm[ge].exists) gEx++; }
            groups.push({ title: gKey, total: gm.length, existsCount: gEx, newCount: gm.length - gEx, mappings: gm });
            delete customGroups[gKey];
        }
    }
    var remaining = Object.keys(customGroups);
    for (var m = 0; m < remaining.length; m++) {
        var rKey = remaining[m];
        if (customGroups[rKey].length) {
            var rm = customGroups[rKey];
            var rEx = 0;
            for (var re = 0; re < rm.length; re++) { if (rm[re].exists) rEx++; }
            groups.push({ title: rKey, total: rm.length, existsCount: rEx, newCount: rm.length - rEx, mappings: rm });
        }
    }

    return {
        titleSuffix: 'Schema field mapping',
        intro:       'Live CTP attribute → SFCC value_type mappings. ' + totalAttrs + ' total attributes across ' + groups.length + ' entity types.',
        groups:      groups
    };
}

/**
 * Build View step content from session schema results.
 * @param {Object} sessionResults - migration results from session
 * @returns {Object} stepContent for stepView.isml
 */
function buildViewContent(sessionResults) {
    var results = sessionResults || {};
    var stats   = [];
    var keys    = Object.keys(results);
    var i;

    for (i = 0; i < keys.length; i++) {
        var key = keys[i];
        var r   = results[key];
        if (r.error) {
            stats.push({ label: key, value: 'Error', sub: r.error });
        } else {
            var created = r.created || r.success || 0;
            var skipped = r.skipped || 0;
            var failed  = r.failed  || 0;
            stats.push({
                label: key,
                value: fmt(created) + ' created',
                sub:   skipped + ' already existed' + (failed ? ', ' + failed + ' failed' : '')
            });
        }
    }

    if (!stats.length) {
        stats = [{ label: 'Status', value: 'No migration results found', sub: 'Complete Step 4 first.' }];
    }

    var totalCreated = 0;
    var totalSkipped = 0;
    for (i = 0; i < keys.length; i++) {
        totalCreated += results[keys[i]].created || results[keys[i]].success || 0;
        totalSkipped += results[keys[i]].skipped || 0;
    }

    return {
        titleSuffix:  'Schema migration summary',
        intro:        fmt(totalCreated) + ' new attribute(s) created across ' + keys.length + ' object type(s). ' + fmt(totalSkipped) + ' already existed and were skipped.',
        stats:        stats
    };
}

/**
 * Save final migration results from the Move step AJAX flow into session.
 * Accepts JSON body: { Product: { created, skipped, failed }, ... }
 * Returns JSON: { ok: true }
 */
exports.SaveMigrationResults = function () {
    response.setContentType('application/json');
    var raw = request.httpParameterMap.results.stringValue || '';
    if (raw) {
        session.custom.schemaMigrationResults = raw;
    }
    response.writer.print(JSON.stringify({ ok: true }));
};
exports.SaveMigrationResults.public = true;

/**
 * Fetch existing SFCC attribute IDs for a task's object type and store in session.
 * Call this ONCE per task before starting runBatch calls.
 * Accepts: task=Product
 * Returns JSON: { ok, task, count }
 */
exports.GetExistingAttrs = function () {
    response.setContentType('application/json');
    var SFCC_OBJ = { Product: 'Product', Category: 'Category', Customer: 'Customer', Order: 'Order', ProductInventoryRecord: 'ProductInventoryRecord', ProductList: 'ProductList', ProductListItem: 'ProductListItem', Promotion: 'Promotion' };
    var task      = request.httpParameterMap.task.stringValue || '';
    var sfccObj   = SFCC_OBJ[task];
    if (!sfccObj) {
        response.writer.print(JSON.stringify({ ok: false, error: 'Invalid task' }));
        return;
    }
    try {
        var sfccClient = require('*/cartridge/scripts/migration/sfccClient');
        var sfccToken = sfccClient.getSFCCToken();
        var existing  = sfccClient.getExistingAttributeIds(sfccToken, sfccObj);
        var ids       = Object.keys(existing);
        // No session.custom write — list is too large (> 2000 char limit)
        response.writer.print(JSON.stringify({ ok: true, task: task, count: ids.length, ids: ids }));
    } catch (e) {
        response.writer.print(JSON.stringify({ ok: false, error: e.message || String(e) }));
    }
};
exports.GetExistingAttrs.public = true;

/**
 * Delete a batch of custom attributes for one task.
 * Accepts: task=Product&offset=0
 * Returns JSON: { ok, task, total, nextOffset, deleted, failed, done }
 */
exports.DeleteTaskAttrs = function () {
    response.setContentType('application/json');
    var SFCC_OBJ  = { Product: 'Product', Category: 'Category', Customer: 'Customer', Order: 'Order', ProductInventoryRecord: 'ProductInventoryRecord', ProductList: 'ProductList', ProductListItem: 'ProductListItem', Promotion: 'Promotion' };
    var task      = request.httpParameterMap.task.stringValue   || '';
    var offset    = parseInt(String(request.httpParameterMap.offset.stringValue || '0'), 10);
    var sfccObj   = SFCC_OBJ[task];

    if (!sfccObj) {
        response.writer.print(JSON.stringify({ ok: false, error: 'Invalid task' }));
        return;
    }

    try {
        var sfccClient2 = require('*/cartridge/scripts/migration/sfccClient');
        var sfccToken2  = sfccClient2.getSFCCToken();               // 1 HTTP call
        var existing2   = sfccClient2.getExistingAttributeIds(sfccToken2, sfccObj); // 1+ HTTP calls
        var ids2        = Object.keys(existing2);
        var batch2      = ids2.slice(offset, offset + 10);
        var deleted2    = 0;
        var failed2     = 0;

        for (var i = 0; i < batch2.length; i++) {
            try {
                sfccClient2.deleteAttributeDefinition(sfccToken2, sfccObj, batch2[i]); // 1 HTTP call each
                deleted2++;
            } catch (de) {
                failed2++;
            }
        }

        var nextOff2 = offset + batch2.length;
        response.writer.print(JSON.stringify({
            ok: true, task: task, total: ids2.length,
            nextOffset: nextOff2, deleted: deleted2, failed: failed2,
            done: nextOff2 >= ids2.length
        }));
    } catch (e) {
        response.writer.print(JSON.stringify({ ok: false, error: e.message || String(e) }));
    }
};
exports.DeleteTaskAttrs.public = true;

/**
 * Migrate one batch of attributes for a single task.
 * Accepts: task=Product&offset=0
 * Returns JSON: { ok, task, total, nextOffset, created, failed, done, errors }
 */
exports.MigrateTask = function () {
    response.setContentType('application/json');
    var params = request.httpParameterMap;
    var task   = params.task.stringValue   || '';
    var offset = parseInt(params.offset.stringValue || '0', 10);

    var ALLOWED_TASKS = { Product: 1, Category: 1, Customer: 1, Order: 1, ProductInventoryRecord: 1, ProductList: 1, ProductListItem: 1, Promotion: 1 };
    if (!task || !ALLOWED_TASKS[task]) {
        response.writer.print(JSON.stringify({ ok: false, error: 'Invalid or missing task param' }));
        return;
    }
    try {
        var runner = require('*/cartridge/scripts/migration/runner');
        var result = runner.runBatch(task, offset, 10);
        response.writer.print(JSON.stringify(result));
    } catch (e) {
        response.writer.print(JSON.stringify({ ok: false, error: e.message || String(e) }));
    }
};
exports.MigrateTask.public = true;

/**
 * Save schema selection from Fetch step to session.
 * Accepts: schemas=Product,Customer,Order  (comma-separated task names)
 */
exports.SaveSchemaSelection = function () {
    response.setContentType('application/json');
    var schemas = request.httpParameterMap.schemas.stringValue || '';
    session.custom.selectedSchemas = schemas;
    response.writer.print(JSON.stringify({ ok: true }));
};
exports.SaveSchemaSelection.public = true;

/**
 * Test CTP connection with credentials from the form (or config fallback).
 * Returns JSON: { ok: true, project: { key, name } } or { ok: false, error: '...' }
 */
exports.TestConnection = function () {
    response.setContentType('application/json');

    var cfg        = require('*/cartridge/scripts/migration/configAccessor');
    var params     = request.httpParameterMap;
    var projectKey   = params.projectKey.stringValue   || cfg.ctp.projectKey   || '';
    var clientId     = params.clientId.stringValue     || cfg.ctp.clientId     || '';
    var apiUrl       = params.apiUrl.stringValue       || cfg.ctp.apiUrl       || '';
    var authUrl      = params.authUrl.stringValue      || cfg.ctp.authUrl      || 'https://auth.us-central1.gcp.commercetools.com';
    var scopes       = params.scopes.stringValue       || cfg.ctp.scopes       || '';

    // clientSecret field shows '••••••••' when pre-loaded — fall back to config value
    var rawSecret    = params.clientSecret.stringValue || '';
    var clientSecret = (rawSecret && rawSecret.indexOf('•') === -1) ? rawSecret : cfg.ctp.clientSecret || '';

    if (!projectKey || !clientId || !clientSecret || !apiUrl) {
        response.writer.print(JSON.stringify({ ok: false, error: 'Missing required credentials.' }));
        return;
    }

    try {
        var result = ctpClient.testConnectionWith({
            projectKey:   projectKey,
            clientId:     clientId,
            clientSecret: clientSecret,
            apiUrl:       apiUrl,
            authUrl:      authUrl,
            scopes:       scopes
        });
        response.writer.print(JSON.stringify({ ok: true, project: result.project }));
    } catch (e) {
        response.writer.print(JSON.stringify({ ok: false, error: e.message || String(e) }));
    }
};
exports.TestConnection.public = true;

/**
 * Migration Console dashboard.
 */
exports.Start = function () {
    ISML.renderTemplate('accelerator/dashboard', {
        title:      Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:   Resource.msg('accelerator.subtitle', 'accelerator', null),
        platforms:  migrationData.getPlatforms(),
        wizardUrl:  URLUtils.url('Accelerator-Wizard').toString(),
        cssUrl:     URLUtils.staticURL('/css/accelerator-migration.css').toString()
    });
};
exports.Start.public = true;

/**
 * Multi-step schema migration wizard.
 */
exports.Wizard = function () {
    var params     = request.httpParameterMap;
    var platformId = params.platform.stringValue || 'commercetools';
    var stepParam  = 1;

    if (params.step && params.step.submitted) {
        var parsed = parseInt(String(params.step.stringValue || '1'), 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
            stepParam = parsed;
        }
    }

    var platform = migrationData.getPlatform(platformId);
    if (!platform || platform.status !== 'ready') {
        response.redirect(URLUtils.url('Accelerator-Start'));
        return;
    }

    var currentStep = Math.min(Math.max(stepParam, 1), migrationData.maxStep);
    var wizardStep  = migrationData.getWizardStep(currentStep);
    var stepContent = migrationData.getStepContent(wizardStep.key);
    var prevStep    = currentStep > 1 ? currentStep - 1 : null;
    var nextStep    = currentStep < migrationData.maxStep ? currentStep + 1 : null;

    // Persist schema selection passed via URL param (from Fetch step Continue button)
    var schemasParam = (params.schemas && params.schemas.submitted) ? String(params.schemas.stringValue || '') : '';
    if (schemasParam) {
        session.custom.selectedSchemas = schemasParam;
    }

    // Step 2: Fetch — live CTP schema counts (commercetools only)
    if (currentStep === 2) {
        if (platformId === 'commercetools') {
            try {
                var schemaCounts = ctpClient.getSchemaCounts();
                stepContent = buildFetchContent(schemaCounts);
            } catch (e) {
                stepContent = {
                    titleSuffix: 'Fetch source schema',
                    intro: 'Could not connect to commercetools. Please verify credentials in Step 1.',
                    sections: [{ title: 'Connection Error', items: ['Unable to reach CTP API — check project key and credentials'] }],
                    summary: 'Go back to Step 1 and verify your CTP credentials.'
                };
            }
        } else {
            stepContent = {
                titleSuffix: 'Not applicable',
                intro: 'Schema migration is only supported for commercetools. Please return to the console and select commercetools.',
                sections: [{ title: 'Information', items: ['Schema migration: commercetools only'] }],
                summary: 'Return to console → select commercetools platform.'
            };
        }
    }

    // Step 3: AI Map — live CTP attribute → SFCC type mapping, filtered by selected schemas
    if (currentStep === 3 && platformId === 'commercetools') {
        try {
            var selectedRaw3   = String(session.custom.selectedSchemas || '');
            var selectedTasks3 = selectedRaw3 ? selectedRaw3.split(',') : null;
            var aiCtpToken     = ctpClient.getCTPToken();
            var aiProdTypes    = ctpClient.fetchProductTypes(aiCtpToken);
            var aiCustTypes    = ctpClient.fetchCustomTypes(aiCtpToken);

            // Fetch existing SFCC attrs per task to show "already migrated" status
            var sfccClient3     = require('*/cartridge/scripts/migration/sfccClient');
            var sfccToken3      = sfccClient3.getSFCCToken();
            var SFCC_OBJ3       = { Product: 'Product', Category: 'Category', Customer: 'Customer', Order: 'Order', ProductInventoryRecord: 'ProductInventoryRecord', ProductList: 'ProductList', ProductListItem: 'ProductListItem', Promotion: 'Promotion' };
            var tasks3          = selectedTasks3 || Object.keys(SFCC_OBJ3);
            var existingByTask3 = {};
            for (var ti = 0; ti < tasks3.length; ti++) {
                var tname = tasks3[ti];
                if (SFCC_OBJ3[tname]) {
                    existingByTask3[tname] = sfccClient3.getExistingAttributeIds(sfccToken3, SFCC_OBJ3[tname]);
                }
            }
            stepContent = buildAiMapContent(aiProdTypes, aiCustTypes, selectedTasks3, existingByTask3);
        } catch (e) {
            // keep static stepContent on error
        }
    }

    // Step 4: Move — AJAX-driven per-task batched migration
    if (currentStep === 4 && platformId === 'commercetools') {
        var selectedRaw4   = String(session.custom.selectedSchemas || '');
        var selectedTasks4 = selectedRaw4
            ? selectedRaw4.split(',')
            : ['Product', 'Category', 'Customer', 'Order', 'ProductInventoryRecord', 'ProductList', 'ProductListItem', 'Promotion'];

        stepContent = {
            titleSuffix:   'Run schema migration',
            intro:         'Click "Start Migration" to create SFCC attribute definitions from CTP schema.',
            selectedTasks: selectedTasks4,
            migrateUrl:    URLUtils.url('Accelerator-MigrateTask').toString()
        };
    }

    // Step 5: View — show results from session
    if (currentStep === 5 && platformId === 'commercetools') {
        var sessionResults = null;
        try { sessionResults = JSON.parse(String(session.custom.schemaMigrationResults || 'null')); } catch (e) { /* no results */ }
        stepContent = buildViewContent(sessionResults);
        try { session.custom.schemaMigrationResults = null; } catch (e) { /* clear session */ }
    }

    ISML.renderTemplate('accelerator/wizard', {
        title:         Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:      Resource.msg('accelerator.subtitle', 'accelerator', null),
        platform:      platform,
        wizardSteps:   migrationData.getWizardSteps(),
        currentStep:   currentStep,
        wizardStep:    wizardStep,
        stepContent:   stepContent,
        prevStep:      prevStep,
        nextStep:      nextStep,
        nextStepLabel: migrationData.getNextStepLabel(currentStep),
        isLastStep:    currentStep >= migrationData.maxStep,
        dashboardUrl:  URLUtils.url('Accelerator-Start').toString(),
        wizardBaseUrl: URLUtils.url('Accelerator-Wizard', 'platform', platform.id).toString(),
        cssUrl:        URLUtils.staticURL('/css/accelerator-migration.css').toString()
    });
};
exports.Wizard.public = true;
