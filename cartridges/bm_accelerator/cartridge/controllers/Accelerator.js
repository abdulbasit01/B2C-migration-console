'use strict';

/* global request, response, session */

/* eslint-disable no-var */

var ISML           = require('dw/template/ISML');
var URLUtils       = require('dw/web/URLUtils');
var Resource       = require('dw/web/Resource');
var migrationData  = require('*/cartridge/scripts/accelerator/migrationData');
var registry       = require('*/cartridge/scripts/migration/connectors/registry');
var runner         = require('*/cartridge/scripts/migration/core/runner');
var nativeFieldMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');

// SFCC system object names, used to look up existing attributes in step 3.
// Shared with core/runner.js#TASK_SFCC_OBJECT (imported here to avoid a second definition).
var SFCC_TASK_OBJECTS = runner.TASK_SFCC_OBJECT;

// ─── Controller helpers ───────────────────────────────────────────────────────

/**
 * @param {number} n - number to format
 * @returns {string} comma-formatted number string
 */
function fmt(n) {
    return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * @param {number} n - step number
 * @returns {string|null} step as string, or null if absent
 */
function toStepQuery(n) {
    if (n === null || n === undefined) return null;
    return String(parseInt(String(n), 10));
}

/**
 * @param {Object} obj - response payload
 * @returns {void}
 */
function jsonResponse(obj) {
    response.setContentType('application/json');
    response.writer.print(JSON.stringify(obj));
}

/**
 * @param {string} name - parameter name
 * @returns {string} parameter value or empty string
 */
function getParam(name) {
    var p = request.httpParameterMap[name];
    return (p && p.submitted) ? String(p.stringValue || '') : '';
}

/**
 * Resolve the active platform from the request param, falling back to session.
 * @returns {string} platform ID
 */
function resolvePlatform() {
    return getParam('platform') || String(session.custom.migrationPlatformId || 'commercetools');
}

/**
 * Build the View step content from session results.
 * @param {Object} sessionResults - migration results keyed by task name
 * @returns {Object} view step content
 */
function buildViewContent(sessionResults) {
    var results = sessionResults || {};
    var keys    = Object.keys(results);
    var stats   = [];
    var totalCreated = 0;
    var totalSkipped = 0;

    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var r   = results[key];
        if (r.error) {
            stats.push({ label: key, value: 'Error', sub: r.error });
        } else {
            var created = r.created || r.success || 0;
            var skipped = r.skipped || 0;
            var failed  = r.failed  || 0;
            totalCreated += created;
            totalSkipped += skipped;
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

    return {
        titleSuffix: 'Schema migration summary',
        intro:       fmt(totalCreated) + ' new attribute(s) created across ' + keys.length + ' object type(s). ' + fmt(totalSkipped) + ' already existed and were skipped.',
        stats:       stats
    };
}

// ─── AJAX endpoints ───────────────────────────────────────────────────────────

/**
 * Test connection with credentials from the connect form.
 * Dispatches to the correct connector via registry — no platform-specific code here.
 */
exports.TestConnection = function () {
    var platformId = getParam('platformId') || 'commercetools';
    var connector  = registry.get(platformId);

    if (!connector) {
        jsonResponse({ ok: false, error: 'Unsupported platform: ' + platformId });
        return;
    }

    // Build creds object from submitted form fields
    var cfg    = require('*/cartridge/scripts/migration/configAccessor');
    var params = request.httpParameterMap;
    var creds  = {};
    // Pull all submitted form fields into creds (excludes platformId hidden field)
    var fieldNames = ['projectKey', 'clientId', 'clientSecret', 'apiUrl', 'authUrl', 'scopes', 'storeUrl', 'apiVersion', 'storeHash'];
    for (var fi = 0; fi < fieldNames.length; fi++) {
        var fn  = fieldNames[fi];
        var val = String((params[fn] && params[fn].stringValue) || '');
        if (val) creds[fn] = val;
    }

    // Masked fields (shown as ••••••••) fall back to stored config
    /**
     * @param {string} paramName - form field name
     * @param {string} configValue - fallback value from config
     * @returns {string} resolved secret value
     */
    function resolveSecret(paramName, configValue) {
        var raw = creds[paramName] || '';
        return (raw && raw.indexOf('•') === -1) ? raw : (configValue || '');
    }

    if (platformId === 'commercetools') {
        creds.clientSecret = resolveSecret('clientSecret', cfg.ctp.clientSecret);
        creds.authUrl      = creds.authUrl || cfg.ctp.authUrl || 'https://auth.us-central1.gcp.commercetools.com';
    } else if (platformId === 'shopify') {
        creds.clientSecret = resolveSecret('clientSecret', cfg.shopify.clientSecret);
    }

    try {
        var result = connector.testConnectionWith(creds);
        // Persist Shopify credentials to session so Steps 2/3 can use them without config.js
        if (platformId === 'shopify') {
            session.custom.shopifyStoreUrl     = creds.storeUrl     || '';
            session.custom.shopifyClientId     = creds.clientId     || '';
            session.custom.shopifyClientSecret = creds.clientSecret || '';
            session.custom.shopifyApiVersion   = creds.apiVersion   || '2025-01';
        }
        jsonResponse({ ok: true, project: result.project });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.TestConnection.public = true;

/**
 * Migrate one batch of attributes for a single task.
 * POST: task=Product&offset=0&platform=shopify
 */
exports.MigrateTask = function () {
    var task     = getParam('task');
    var offset   = parseInt(getParam('offset') || '0', 10);
    var platform = resolvePlatform();

    if (!task || !SFCC_TASK_OBJECTS[task]) {
        jsonResponse({ ok: false, error: 'Invalid or missing task param' });
        return;
    }

    var connector = registry.get(platform);
    if (!connector) {
        jsonResponse({ ok: false, error: 'Unsupported platform: ' + platform });
        return;
    }

    try {
        jsonResponse(runner.runBatch(connector, task, offset, 10));
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.MigrateTask.public = true;

/**
 * Fetch existing SFCC attribute IDs for a task. Platform-agnostic.
 * POST: task=Product
 */
exports.GetExistingAttrs = function () {
    var task    = getParam('task');
    var sfccObj = SFCC_TASK_OBJECTS[task];
    if (!sfccObj) {
        jsonResponse({ ok: false, error: 'Invalid task' });
        return;
    }
    try {
        var sfccClient = require('*/cartridge/scripts/migration/sfccClient');
        var token      = sfccClient.getSFCCToken();
        var existing   = sfccClient.getExistingAttributeIds(token, sfccObj);
        var ids        = Object.keys(existing);
        jsonResponse({ ok: true, task: task, count: ids.length, ids: ids });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.GetExistingAttrs.public = true;

/**
 * Return source-schema attribute definitions for a task (id + SFCC type).
 * Used by the View step to display exactly what was (or can be) migrated.
 * POST: task=Product&platform=shopify
 */
exports.GetMigratedAttrs = function () {
    var task      = getParam('task');
    var platform  = resolvePlatform();
    var connector = registry.get(platform);

    if (!SFCC_TASK_OBJECTS[task]) {
        jsonResponse({ ok: false, error: 'Invalid task' });
        return;
    }
    if (!connector) {
        jsonResponse({ ok: false, error: 'Unsupported platform: ' + platform });
        return;
    }

    try {
        var defs  = connector.getAttrDefsForTask(task);
        var attrs = [];
        for (var i = 0; i < defs.length; i++) {
            if (!nativeFieldMap.isSkipped(connector.id, task, defs[i].id)) {
                attrs.push({ id: defs[i].id, sfccType: defs[i].value_type });
            }
        }
        jsonResponse({ ok: true, task: task, attrs: attrs });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.GetMigratedAttrs.public = true;

/**
 * Delete a batch of source-schema attributes from SFCC.
 * POST: task=Product&offset=0&platform=shopify
 */
exports.DeleteTaskAttrs = function () {
    var task      = getParam('task');
    var offset    = parseInt(getParam('offset') || '0', 10);
    var platform  = resolvePlatform();
    var connector = registry.get(platform);

    if (!SFCC_TASK_OBJECTS[task]) {
        jsonResponse({ ok: false, error: 'Invalid task' });
        return;
    }
    if (!connector) {
        jsonResponse({ ok: false, error: 'Unsupported platform: ' + platform });
        return;
    }

    try {
        jsonResponse(runner.deleteBatch(connector, task, offset, 10));
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.DeleteTaskAttrs.public = true;

/**
 * Persist schema task selection from the Fetch step.
 * POST: schemas=Product,Customer,Order
 */
exports.SaveSchemaSelection = function () {
    response.setContentType('application/json');
    session.custom.selectedSchemas = getParam('schemas');
    response.writer.print(JSON.stringify({ ok: true }));
};
exports.SaveSchemaSelection.public = true;

/**
 * Persist final migration results from the Move step AJAX flow.
 * POST: results={"Product":{"created":3,"skipped":1,"failed":0}, …}
 */
exports.SaveMigrationResults = function () {
    response.setContentType('application/json');
    var raw = getParam('results');
    if (raw) session.custom.schemaMigrationResults = raw;
    response.writer.print(JSON.stringify({ ok: true }));
};
exports.SaveMigrationResults.public = true;

// ─── Page endpoints ───────────────────────────────────────────────────────────

exports.Start = function () {
    ISML.renderTemplate('accelerator/dashboard', {
        title:                Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:             Resource.msg('accelerator.subtitle', 'accelerator', null),
        platforms:            migrationData.getPlatforms(),
        wizardUrl:            URLUtils.url('Accelerator-Wizard').toString(),
        customerMigrationUrl: URLUtils.url('Accelerator-CustomerMigration').toString(),
        productWizardUrl:     URLUtils.url('Accelerator-ProductWizard').toString(),
        cssUrl:               URLUtils.staticURL('/css/accelerator-migration.css').toString()
    });
};
exports.Start.public = true;

exports.Wizard = function () {
    var params     = request.httpParameterMap;
    var platformId = String((params.platform && params.platform.stringValue) || 'commercetools');
    var stepParam  = 1;

    if (params.step && params.step.submitted) {
        var parsed = parseInt(String(params.step.stringValue || '1'), 10);
        if (!Number.isNaN(parsed) && parsed > 0) stepParam = parsed;
    }

    var platform = migrationData.getPlatform(platformId);
    if (!platform || platform.status !== 'ready') {
        response.redirect(URLUtils.url('Accelerator-Start'));
        return;
    }

    var currentStep = parseInt(String(Math.min(Math.max(stepParam, 1), migrationData.maxStep)), 10);
    var wizardStep  = migrationData.getWizardStep(currentStep);
    var stepContent = null;  // resolved per step below
    var prevStep    = currentStep > 1 ? currentStep - 1 : null;
    var nextStep    = currentStep < migrationData.maxStep ? currentStep + 1 : null;

    // Track the active platform so AJAX endpoints can read it from session
    session.custom.migrationPlatformId = platformId;

    // Persist schema selection from the Fetch step Continue button
    var schemasParam = (params.schemas && params.schemas.submitted) ? String(params.schemas.stringValue || '') : '';
    if (schemasParam) session.custom.selectedSchemas = schemasParam;

    var connector    = registry.get(platformId);
    var selectedRaw  = String(session.custom.selectedSchemas || '');
    var selectedTasks = selectedRaw ? selectedRaw.split(',') : null;

    // ── Step 2: Fetch schema counts ───────────────────────────────────────────
    if (currentStep === 2) {
        if (connector) {
            try {
                stepContent = connector.buildFetchContent(connector.getSchemaCounts());
            } catch (e) {
                stepContent = {
                    titleSuffix: 'Fetch source schema',
                    intro:       'Could not connect to ' + platform.name + '. Please verify credentials in Step 1.',
                    sections:    [{ title: 'Connection Error', items: [e.message || 'Unknown error'], selectable: false }],
                    summary:     'Go back to Step 1 and verify your credentials.'
                };
            }
        }
    }

    // ── Step 3: AI Map ────────────────────────────────────────────────────────
    if (currentStep === 3 && connector) {
        try {
            var sfccClient3  = require('*/cartridge/scripts/migration/sfccClient');
            var sfccToken3   = sfccClient3.getSFCCToken();
            var tasks3       = selectedTasks || connector.getDefaultTasks();
            var existing3    = {};
            for (var ti = 0; ti < tasks3.length; ti++) {
                var tname = tasks3[ti];
                if (SFCC_TASK_OBJECTS[tname]) {
                    existing3[tname] = sfccClient3.getExistingAttributeIds(sfccToken3, SFCC_TASK_OBJECTS[tname]);
                }
            }
            stepContent = connector.buildAiMapContent(selectedTasks, existing3);
        } catch (e) {
            stepContent = {
                titleSuffix: 'Schema field mapping',
                intro:       'Could not load schema mapping: ' + (e.message || 'Unknown error') + '. Please verify credentials in Step 1.',
                groups:      []
            };
        }
    }

    // ── Step 4: Move ──────────────────────────────────────────────────────────
    if (currentStep === 4 && connector) {
        var defaultTasks4  = connector.getDefaultTasks();
        var selectedTasks4 = selectedTasks || defaultTasks4;
        stepContent = {
            titleSuffix:   'Run schema migration',
            intro:         'Click "Start Migration" to create SFCC attribute definitions from ' + platform.name + ' schema.',
            selectedTasks: selectedTasks4,
            migrateUrl:    URLUtils.url('Accelerator-MigrateTask', 'platform', platformId).toString()
        };
    }

    // ── Step 5: View ──────────────────────────────────────────────────────────
    if (currentStep === 5) {
        var sessionResults = null;
        try { sessionResults = JSON.parse(String(session.custom.schemaMigrationResults || 'null')); } catch (e) { /* no results yet */ }
        stepContent = buildViewContent(sessionResults);
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
        prevStepQuery: toStepQuery(prevStep),
        nextStepQuery: toStepQuery(nextStep),
        nextStepLabel: migrationData.getNextStepLabel(currentStep),
        isLastStep:    currentStep >= migrationData.maxStep,
        dashboardUrl:  URLUtils.url('Accelerator-Start').toString(),
        wizardBaseUrl: URLUtils.url('Accelerator-Wizard', 'platform', platform.id).toString(),
        cssUrl:        URLUtils.staticURL('/css/accelerator-migration.css').toString()
    });
};
exports.Wizard.public = true;

// ─── Customer data migration ──────────────────────────────────────────────────

/**
 * Customer migration page — standalone, separate from the schema wizard.
 */
exports.CustomerMigration = function () {
    var cfg2           = require('*/cartridge/scripts/migration/configAccessor');
    var customerListId = (cfg2.sfcc && cfg2.sfcc.customerListId) ? cfg2.sfcc.customerListId : '';
    ISML.renderTemplate('accelerator/customerMigration', {
        title:          Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:       Resource.msg('accelerator.subtitle', 'accelerator', null),
        customerListId: customerListId,
        dashboardUrl:   URLUtils.url('Accelerator-Start').toString(),
        cssUrl:         URLUtils.staticURL('/css/accelerator-migration.css').toString(),
        countUrl:       URLUtils.url('Accelerator-CustomerMigrationCount').toString(),
        profileUrl:     URLUtils.url('Accelerator-MigrateCustomerBatch').toString(),
        addressUrl:     URLUtils.url('Accelerator-MigrateCustomerAddresses').toString(),
        fullBatchUrl:   URLUtils.url('Accelerator-FullMigrationBuildBatch').toString(),
        byIdUrl:        URLUtils.url('Accelerator-MigrateCustomerById').toString(),
        triggerJobUrl:  URLUtils.url('Accelerator-FullMigrationTriggerJob').toString(),
        jobStatusUrl:   URLUtils.url('Accelerator-FullMigrationJobStatus').toString()
    });
};
exports.CustomerMigration.public = true;

/**
 * Return the total number of customers in the CTP project.
 * GET/POST — no params required.
 */
exports.CustomerMigrationCount = function () {
    try {
        var ctpFetcher = require('*/cartridge/scripts/migration/customerMigration/ctpCustomerFetcher');
        jsonResponse({ ok: true, total: ctpFetcher.getCount() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CustomerMigrationCount.public = true;

/**
 * Migrate one batch of customer profiles from CTP to SFCC.
 * POST: offset=<n>&listId=<sfcc-customer-list-id>
 * Response includes mappings[] for the caller to drive phase 2 (address migration).
 */
exports.MigrateCustomerBatch = function () {
    var offset = parseInt(getParam('offset') || '0', 10);
    var listId = getParam('listId');

    if (!listId) {
        jsonResponse({ ok: false, error: 'listId parameter is required' });
        return;
    }
    try {
        var custRunner = require('*/cartridge/scripts/migration/customerMigration/customerMigrationRunner');
        jsonResponse(custRunner.runProfileBatch(offset, listId));
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.MigrateCustomerBatch.public = true;

/**
 * Migrate addresses for one already-created SFCC customer.
 * POST: customerNo=<sfcc-no>&listId=<id>&addresses=<json-array>&offset=<n>
 */
exports.MigrateCustomerAddresses = function () {
    var customerNo = getParam('customerNo');
    var listId     = getParam('listId');
    var offset     = parseInt(getParam('offset') || '0', 10);
    var rawAddrs   = getParam('addresses');

    if (!customerNo || !listId) {
        jsonResponse({ ok: false, error: 'customerNo and listId are required' });
        return;
    }

    var addresses = [];
    try {
        addresses = JSON.parse(rawAddrs || '[]');
    } catch (e) {
        jsonResponse({ ok: false, error: 'Invalid addresses JSON' });
        return;
    }

    try {
        var custRunner2 = require('*/cartridge/scripts/migration/customerMigration/customerMigrationRunner');
        jsonResponse(custRunner2.runAddressBatch(customerNo, addresses, listId, offset));
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.MigrateCustomerAddresses.public = true;

/**
 * Full Migration — fetch one batch of 500 CTP customers, build SFCC import XML, upload via WebDAV.
 * POST: offset=<n>&listId=<sfcc-customer-list-id>
 */
exports.FullMigrationBuildBatch = function () {
    var offset = parseInt(getParam('offset') || '0', 10);
    var listId = getParam('listId');

    if (!listId) {
        jsonResponse({ ok: false, error: 'listId is required' });
        return;
    }
    try {
        var fullRunner = require('*/cartridge/scripts/migration/customerMigration/fullMigrationRunner');
        jsonResponse(fullRunner.runBatch(offset, listId));
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.FullMigrationBuildBatch.public = true;

/**
 * Partial Migration (ID mode) — migrate one specific customer by CTP customer ID.
 * POST: ctpId=<ctp-uuid>&listId=<sfcc-customer-list-id>
 */
exports.MigrateCustomerById = function () {
    var ctpId  = getParam('ctpId');
    var listId = getParam('listId');

    if (!ctpId || !listId) {
        jsonResponse({ ok: false, error: 'ctpId and listId are required' });
        return;
    }
    try {
        var byIdRunner = require('*/cartridge/scripts/migration/customerMigration/customerMigrationRunner');
        jsonResponse(byIdRunner.runProfileBatchById(ctpId, listId));
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.MigrateCustomerById.public = true;

/**
 * Full Migration — trigger the SFCC import job via OCAPI Data API (self-call).
 * POST: jobId=<BM-job-id>
 *
 * Prerequisite: the OCAPI client configured in sfccClient must have the Jobs resource
 * with POST method enabled in Administration → Global Preferences → Open Commerce API Settings.
 */
exports.FullMigrationTriggerJob = function () {
    var jobId = getParam('jobId');
    if (!jobId) {
        jsonResponse({ ok: false, error: 'jobId is required' });
        return;
    }
    try {
        var sfccClient4 = require('*/cartridge/scripts/migration/sfccClient');
        var token       = sfccClient4.getSFCCToken();
        var HTTPClient4 = require('dw/net/HTTPClient');
        var http4       = new HTTPClient4();
        var url4        = 'https://' + request.httpHost
                        + '/s/-/dw/data/v24_5/jobs/' + encodeURIComponent(jobId) + '/executions';
        http4.open('POST', url4);
        http4.setRequestHeader('Authorization', 'Bearer ' + token);
        http4.setRequestHeader('Content-Type', 'application/json');
        http4.send('{}');
        var sc4 = http4.statusCode;
        if (sc4 === 200 || sc4 === 201) {
            var resp4 = {};
            try { resp4 = JSON.parse(http4.text || '{}'); } catch (pe) { resp4 = {}; }
            jsonResponse({ ok: true, executionId: String(resp4.id || ''), status: String(resp4.status || 'pending') });
        } else {
            jsonResponse({ ok: false, error: 'OCAPI trigger failed (HTTP ' + sc4 + '): ' + (http4.text || '') });
        }
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.FullMigrationTriggerJob.public = true;

/**
 * Full Migration — poll the execution status of an import job.
 * POST: jobId=<BM-job-id>&executionId=<execution-id>
 */
exports.FullMigrationJobStatus = function () {
    var jobId5       = getParam('jobId');
    var executionId5 = getParam('executionId');
    if (!jobId5 || !executionId5) {
        jsonResponse({ ok: false, error: 'jobId and executionId are required' });
        return;
    }
    try {
        var sfccClient5 = require('*/cartridge/scripts/migration/sfccClient');
        var token5      = sfccClient5.getSFCCToken();
        var HTTPClient5 = require('dw/net/HTTPClient');
        var http5       = new HTTPClient5();
        var url5        = 'https://' + request.httpHost
                        + '/s/-/dw/data/v24_5/jobs/' + encodeURIComponent(jobId5)
                        + '/executions/' + encodeURIComponent(executionId5);
        http5.open('GET', url5);
        http5.setRequestHeader('Authorization', 'Bearer ' + token5);
        http5.send(null);
        var sc5 = http5.statusCode;
        if (sc5 === 200) {
            var resp5 = {};
            try { resp5 = JSON.parse(http5.text || '{}'); } catch (pe) { resp5 = {}; }
            var dur5 = resp5.duration ? Math.round(resp5.duration / 1000) : null;
            jsonResponse({
                ok:       true,
                status:   String(resp5.status || 'unknown'),
                duration: dur5,
                message:  resp5.end_time ? 'Completed at ' + resp5.end_time : null
            });
        } else {
            jsonResponse({ ok: false, error: 'Status check failed (HTTP ' + sc5 + ')' });
        }
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.FullMigrationJobStatus.public = true;

// ─── Product catalog migration wizard ─────────────────────────────────────────

/**
 * Product migration wizard — 5-step flow: Connect → Fetch → Configure → Move → View.
 * Produces SFCC catalog XML files uploaded via WebDAV, then triggers a BM import job.
 */
exports.ProductWizard = function () {
    ISML.renderTemplate('accelerator/productMigration', {
        title:        Resource.msg('accelerator.title', 'accelerator', null),
        catalogId:    String(session.custom.prodWizardCatalogId || ''),
        countUrl:     URLUtils.url('Accelerator-ProductMigrationCount').toString(),
        fullBatchUrl: URLUtils.url('Accelerator-FullProductMigrationBuildBatch').toString(),
        triggerJobUrl: URLUtils.url('Accelerator-FullMigrationTriggerJob').toString(),
        jobStatusUrl:  URLUtils.url('Accelerator-FullMigrationJobStatus').toString(),
        saveConfigUrl: URLUtils.url('Accelerator-SaveProdConfig').toString(),
        dashboardUrl:  URLUtils.url('Accelerator-Start').toString(),
        cssUrl:        URLUtils.staticURL('/css/accelerator-migration.css').toString()
    });
};
exports.ProductWizard.public = true;

/**
 * Save product wizard configuration (Step 3) to session.
 * POST: catalogId=<id>&pricebookId=<id>&currency=<code>&inventoryListId=<id>
 */
exports.SaveProdConfig = function () {
    var catalogId       = getParam('catalogId');
    var pricebookId     = getParam('pricebookId')     || 'list-prices';
    var currency        = getParam('currency')         || 'USD';
    var inventoryListId = getParam('inventoryListId')  || 'default-inventory';

    if (!catalogId) {
        jsonResponse({ ok: false, error: 'catalogId is required' });
        return;
    }
    session.custom.prodWizardCatalogId       = catalogId;
    session.custom.prodWizardPricebookId     = pricebookId;
    session.custom.prodWizardCurrency        = currency.toUpperCase();
    session.custom.prodWizardInventoryListId = inventoryListId;
    jsonResponse({ ok: true });
};
exports.SaveProdConfig.public = true;

/**
 * Save product wizard migration results (Step 4) to session for display in Step 5.
 * POST: results=<json>
 */
exports.SaveProdWizardResults = function () {
    var raw = getParam('results');
    if (raw) session.custom.prodWizardResults = raw;
    jsonResponse({ ok: true });
};
exports.SaveProdWizardResults.public = true;

/**
 * Return total number of products in the CTP project.
 */
exports.ProductMigrationCount = function () {
    try {
        var prodFetcher = require('*/cartridge/scripts/migration/productMigration/ctpProductFetcher');
        jsonResponse({ ok: true, total: prodFetcher.getCount() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.ProductMigrationCount.public = true;

/**
 * Full Product Migration — fetch one batch of 500 CTP products, build catalog + pricebook + inventory XML, upload via WebDAV.
 * POST: offset=<n>&catalogId=<id>&pricebookId=<id>&currency=<code>&inventoryListId=<id>
 */
exports.FullProductMigrationBuildBatch = function () {
    var offset          = parseInt(getParam('offset') || '0', 10);
    var catalogId       = getParam('catalogId')       || String(session.custom.prodWizardCatalogId       || '');
    var pricebookId     = getParam('pricebookId')     || String(session.custom.prodWizardPricebookId     || 'list-prices');
    var currency        = getParam('currency')        || String(session.custom.prodWizardCurrency        || 'USD');
    var inventoryListId = getParam('inventoryListId') || String(session.custom.prodWizardInventoryListId || 'default-inventory');

    if (!catalogId) {
        jsonResponse({ ok: false, error: 'catalogId is required' });
        return;
    }
    try {
        var prodRunner = require('*/cartridge/scripts/migration/productMigration/fullProductMigrationRunner');
        jsonResponse(prodRunner.runBatch(offset, catalogId, pricebookId, currency, inventoryListId));
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.FullProductMigrationBuildBatch.public = true;
