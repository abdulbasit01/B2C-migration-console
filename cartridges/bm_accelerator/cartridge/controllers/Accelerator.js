'use strict';

/* global request, response, session, Packages */

/* eslint-disable no-var */

var ISML           = require('dw/template/ISML');
var URLUtils       = require('dw/web/URLUtils');
var Resource       = require('dw/web/Resource');
var migrationData  = require('*/cartridge/scripts/accelerator/migrationData');
var dataMigrationSession = require('*/cartridge/scripts/accelerator/dataMigrationSession');
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
 * Attach Business Manager navigation frame context for MenuFrame.isml.
 * @param {Object} pdict
 * @param {string} [menuActionId]
 * @returns {Object}
 */
function withBmFrame(pdict, menuActionId) {
    pdict.SelectedMenuItem = 'rc_accelerator_tools';
    pdict.CurrentMenuItemId = menuActionId || 'rc_accelerator_wizard';
    return pdict;
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
 * JSON-encoded value safe to embed in inline <script> (includes quotes).
 * @param {*} val
 * @returns {string}
 */
function toJsLiteral(val) {
    return JSON.stringify(val == null ? '' : String(val));
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
 * @returns {boolean} whether data migration connection was verified in this session
 */
function isDataMigrationConnected() {
    return dataMigrationSession.isConnected();
}

/**
 * Shared IMPEX + wizard entry URLs for dedicated migration pages.
 * @param {string} platformId
 * @param {string} moduleKey - key in migrationPaths.MODULE_IDS
 * @returns {Object}
 */
function migrationPageContext(platformId, moduleKey) {
    var migPaths = require('*/cartridge/scripts/migration/core/migrationPaths');
    var bmLinks  = require('*/cartridge/scripts/accelerator/bmLinks');
    var impexPath = migPaths.getRelativePath(moduleKey);
    return {
        impexPath:          impexPath,
        impexUrl:           bmLinks.getImpexFolderUrl(impexPath),
        dataWizardEntryUrl: dataMigrationSession.dataWizardUrl(platformId),
        dataWizardSelectUrl: dataMigrationSession.dataWizardSelectUrl(platformId)
    };
}

/**
 * Build connector credentials from submitted form params.
 * @param {string} platformId - source platform identifier
 * @returns {Object} credentials object for the connector
 */
function buildConnectionCreds(platformId) {
    var cfg    = require('*/cartridge/scripts/migration/configAccessor');
    var params = request.httpParameterMap;
    var creds  = {};
    var fieldNames = ['projectKey', 'clientId', 'clientSecret', 'apiUrl', 'authUrl', 'storeUrl', 'apiVersion', 'storeHash'];

    for (var fi = 0; fi < fieldNames.length; fi++) {
        var fn  = fieldNames[fi];
        var val = String((params[fn] && params[fn].stringValue) || '');
        if (val) creds[fn] = val;
    }

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
        creds.apiUrl       = creds.apiUrl  || cfg.ctp.apiUrl  || 'https://api.us-central1.gcp.commercetools.com';
        creds.projectKey   = creds.projectKey || cfg.ctp.projectKey || '';
    } else if (platformId === 'shopify') {
        creds.clientSecret = resolveSecret('clientSecret', cfg.shopify.clientSecret);
    }

    return creds;
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
    var creds = buildConnectionCreds(platformId);

    try {
        var result = connector.testConnectionWith(creds);
        // Persist Shopify credentials to session so Steps 2/3 can use them without config.js
        if (platformId === 'shopify') {
            session.custom.shopifyStoreUrl     = creds.storeUrl     || '';
            session.custom.shopifyClientId     = creds.clientId     || '';
            session.custom.shopifyClientSecret = creds.clientSecret || '';
            session.custom.shopifyApiVersion   = creds.apiVersion   || '2025-01';
        }
        if (getParam('mode') === 'data') {
            dataMigrationSession.markConnected(platformId, result.expiresIn);
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
    ISML.renderTemplate('accelerator/dashboard', withBmFrame({
        title:                     Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:                  Resource.msg('accelerator.subtitle', 'accelerator', null),
        platforms:                 migrationData.getPlatforms(),
        wizardUrl:                 URLUtils.url('Accelerator-Wizard').toString(),
        dataWizardUrl:             URLUtils.url('Accelerator-DataWizard').toString(),
        dataMigrationDashboardUrl: URLUtils.url('Accelerator-DataMigrationDashboard').toString(),
        customerMigrationUrl:      URLUtils.url('Accelerator-CustomerMigration').toString(),
        shippingMethodMigrationUrl: URLUtils.url('Accelerator-ShippingMethodMigration').toString(),
        inventoryMigrationUrl:     URLUtils.url('Accelerator-InventoryMigration').toString(),
        pricebookMigrationUrl:     URLUtils.url('Accelerator-PricebookMigration').toString(),
        taxMigrationUrl:           URLUtils.url('Accelerator-TaxMigration').toString(),
        storeMigrationUrl:         URLUtils.url('Accelerator-StoreMigration').toString(),
        productWizardUrl:          URLUtils.url('Accelerator-ProductWizard').toString(),
        categoryMigrationUrl:      URLUtils.url('Accelerator-CategoryMigration').toString(),
        cssUrl:                    URLUtils.staticURL('/css/accelerator-migration.css').toString(),
        jsUrl: URLUtils.staticURL('/js/categoryMigration.js').toString(),
        fetchCatalogsUrl : URLUtils.url('Accelerator-FetchSFCCCatalogs').toString(),
        createCatalogUrl : URLUtils.url('Accelerator-CreateCatalog').toString(),
        createCategoryUrl: URLUtils.url('Accelerator-CreateCategory').toString()
    }));
};
exports.Start.public = true;

/**
 * Legacy entry — redirect into the data wizard (connect → select data).
 */
exports.DataMigrationDashboard = function () {
    var platformId = getParam('platform') || String(session.custom.migrationPlatformId || 'commercetools');
    response.redirect(URLUtils.url(
        'Accelerator-DataWizard',
        'platform', platformId,
        'step', dataMigrationSession.connectOrSelectStep()
    ));
};
exports.DataMigrationDashboard.public = true;

/**
 * Order Migration — redirect into the data wizard order flow.
 */
exports.OrderMigration = function () {
    var platformId = getParam('platform') || String(session.custom.migrationPlatformId || 'commercetools');

    if (!isDataMigrationConnected()) {
        response.redirect(URLUtils.url(
            'Accelerator-DataWizard',
            'platform', platformId,
            'step', dataMigrationSession.connectOrSelectStep()
        ));
        return;
    }

    session.custom.selectedDataType = 'order';
    response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '3'));
};
exports.OrderMigration.public = true;

/**
 * Export orders from commercetools and generate IMPEX package.
 * POST: years=1|2|3&maxCount=optional&orderState=optional&paymentState=optional
 */
exports.ExportOrders = function () {
    var years    = parseInt(getParam('years') || String(session.custom.orderExportYears || '1'), 10);
    var maxRaw   = getParam('maxCount') || String(session.custom.orderExportMaxCount || '');
    var maxCount = maxRaw ? parseInt(maxRaw, 10) : null;
    var orderState   = getParam('orderState') || String(session.custom.orderExportOrderState || '');
    var paymentState = getParam('paymentState') || String(session.custom.orderExportPaymentState || '');

    if ([1, 2, 3].indexOf(years) < 0) {
        jsonResponse({ ok: false, error: 'Years must be 1, 2, or 3' });
        return;
    }

    if (!migrationData.isValidCtpOrderState(orderState) || !migrationData.isValidCtpPaymentState(paymentState)) {
        jsonResponse({ ok: false, error: 'Invalid order or payment state filter' });
        return;
    }

    try {
        var runner2 = require('*/cartridge/scripts/migration/orders/orderMigrationRunner');
        var report  = runner2.run({
            years:        years,
            maxCount:     maxCount,
            orderState:   orderState,
            paymentState: paymentState
        });

        session.custom.orderMigrationReport = JSON.stringify({
            ordersProcessed:   report.ordersProcessed,
            ordersValidated:   report.ordersValidated,
            ordersFailed:      report.ordersFailed,
            xmlFilesGenerated: report.xmlFilesGenerated,
            runId:             report.runId,
            impexPath:         report.impexPath || 'src/migration/order'
        });

        jsonResponse({
            ok:     true,
            report: {
                ordersProcessed:   report.ordersProcessed,
                ordersValidated:   report.ordersValidated,
                ordersFailed:      report.ordersFailed,
                xmlFilesGenerated: report.xmlFilesGenerated
            },
            runId: report.runId
        });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.ExportOrders.public = true;

/**
 * Count orders matching export filters (commercetools query total).
 * POST: years=1|2|3&maxCount=optional&orderState=optional&paymentState=optional
 */
exports.CountOrders = function () {
    if (!isDataMigrationConnected()) {
        jsonResponse({ ok: false, error: 'Not connected to source platform' });
        return;
    }

    var years        = parseInt(getParam('years') || '1', 10);
    var maxRaw       = getParam('maxCount') || '';
    var maxCount     = maxRaw ? parseInt(maxRaw, 10) : null;
    var orderState   = getParam('orderState') || '';
    var paymentState = getParam('paymentState') || '';

    if ([1, 2, 3].indexOf(years) < 0) {
        jsonResponse({ ok: false, error: 'Years must be 1, 2, or 3' });
        return;
    }

    if (!migrationData.isValidCtpOrderState(orderState) || !migrationData.isValidCtpPaymentState(paymentState)) {
        jsonResponse({ ok: false, error: 'Invalid order or payment state filter' });
        return;
    }

    try {
        var ctpOrderConnector = require('*/cartridge/scripts/migration/orders/connectors/ctpOrderConnector');
        var counts = ctpOrderConnector.countOrders({
            years:        years,
            maxCount:     maxCount,
            orderState:   orderState,
            paymentState: paymentState
        });

        jsonResponse({
            ok:          true,
            total:       counts.total,
            exportCount: counts.exportCount
        });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CountOrders.public = true;

exports.CheckOrderAttributes = function () {
    try {
        var checker = require('*/cartridge/scripts/migration/orders/orderAttrChecker');
        jsonResponse({ ok: true, missing: checker.checkMissingAttributes() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CheckOrderAttributes.public = true;

exports.CreateOrderAttributes = function () {
    var rawAttrs = getParam('attrs');
    var attrs    = [];
    try { attrs = JSON.parse(rawAttrs || '[]'); } catch (e) {
        jsonResponse({ ok: false, error: 'Invalid attrs JSON' });
        return;
    }
    if (!attrs.length) {
        jsonResponse({ ok: false, error: 'No attributes provided' });
        return;
    }
    try {
        var checker = require('*/cartridge/scripts/migration/orders/orderAttrChecker');
        jsonResponse({ ok: true, result: checker.createAttributes(attrs) });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CreateOrderAttributes.public = true;

/**
 * Download a generated migration file from IMPEX/src/migration/.
 * GET: path=src/migration/{runId}/src/orders/orders_001.xml
 */
exports.DownloadMigrationFile = function () {
    var File = require('dw/io/File');
    var relPath = getParam('path');

    if (!relPath || relPath.indexOf('..') >= 0 || relPath.indexOf('src/migration/') !== 0) {
        response.setStatus(400);
        response.writer.print('Invalid path');
        return;
    }

    var file = new File(File.IMPEX + File.SEPARATOR + relPath);
    if (!file.exists() || !file.isFile()) {
        response.setStatus(404);
        response.writer.print('File not found');
        return;
    }

    var fileName = file.getName();
    var isZip    = fileName.indexOf('.zip') === fileName.length - 4;
    response.setContentType(isZip ? 'application/zip' : 'application/xml');
    response.setHttpHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');

    var fis = new Packages.java.io.FileInputStream(file.fullPath);
    try {
        Packages.org.apache.commons.io.IOUtils.copy(fis, response.base.getOutputStream());
    } finally {
        fis.close();
    }
};
exports.DownloadMigrationFile.public = true;

/**
 * Data migration wizard — connect, select type, then type-specific steps.
 */
exports.DataWizard = function () {
    var params       = request.httpParameterMap;
    var platformId   = String((params.platform && params.platform.stringValue) || 'commercetools');
    var stepParam    = 1;
    var typeParam    = getParam('type');

    if (params.step && params.step.submitted) {
        var parsed = parseInt(String(params.step.stringValue || '1'), 10);
        if (parsed > 0) stepParam = parsed;
    }

    if (typeParam) {
        session.custom.selectedDataType = typeParam;
    } else if (stepParam <= 2) {
        delete session.custom.selectedDataType;
    }

    var platform = migrationData.getPlatform(platformId);
    if (!platform || platform.status !== 'ready') {
        response.redirect(URLUtils.url('Accelerator-Start'));
        return;
    }

    var dataTypeId  = String(session.custom.selectedDataType || typeParam || '');
    var maxStep     = migrationData.getMaxDataStep(dataTypeId);
    var currentStep = parseInt(String(Math.min(Math.max(stepParam, 1), maxStep)), 10);
    var wizardStep  = migrationData.getDataWizardStep(currentStep, dataTypeId);
    var prevStep    = currentStep > 1 ? currentStep - 1 : null;
    var nextStep    = currentStep < maxStep ? currentStep + 1 : null;

    session.custom.migrationPlatformId = platformId;

    if (currentStep === 1 && dataMigrationSession.isConnected()) {
        response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '2'));
        return;
    }

    if (currentStep > 1 && !isDataMigrationConnected()) {
        response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '1'));
        return;
    }

    if (currentStep > 2 && !dataTypeId) {
        response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '2'));
        return;
    }

    // Types with dedicated migration pages redirect directly at step 3.
    if (currentStep > 2 && dataTypeId === 'customer') {
        response.redirect(URLUtils.url('Accelerator-CustomerMigration'));
        return;
    }
    if (currentStep > 2 && dataTypeId === 'shippingMethod') {
        response.redirect(URLUtils.url('Accelerator-ShippingMethodMigration'));
        return;
    }
    if (currentStep > 2 && dataTypeId === 'inventory') {
        response.redirect(URLUtils.url('Accelerator-InventoryMigration'));
        return;
    }
    if (currentStep > 2 && dataTypeId === 'pricebook') {
        response.redirect(URLUtils.url('Accelerator-PricebookMigration'));
        return;
    }
    if (currentStep > 2 && dataTypeId === 'taxation') {
        response.redirect(URLUtils.url('Accelerator-TaxMigration'));
        return;
    }
    if (currentStep > 2 && dataTypeId === 'store') {
        response.redirect(URLUtils.url('Accelerator-StoreMigration'));
        return;
    }
    if (currentStep > 2 && dataTypeId === 'product') {
        response.redirect(URLUtils.url('Accelerator-ProductWizard'));
        return;
    }
    if (currentStep > 2 && dataTypeId === 'catalog') {
        response.redirect(URLUtils.url('Accelerator-CategoryMigration'));
        return;
    }

    if (currentStep > 2 && dataTypeId !== 'order' && wizardStep.key !== 'typePlaceholder') {
        response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '3'));
        return;
    }

    var orderReport = null;
    var bmImpexUrl  = '';
    if (wizardStep.key === 'orderReview') {
        try {
            orderReport = JSON.parse(String(session.custom.orderMigrationReport || 'null'));
            if (orderReport) {
                var bmLinks  = require('*/cartridge/scripts/accelerator/bmLinks');
                var migPaths = require('*/cartridge/scripts/migration/core/migrationPaths');
                bmImpexUrl = bmLinks.getImpexFolderUrl(
                    orderReport.impexPath || migPaths.getRelativePath('order')
                );
            }
        } catch (e) { /* no report yet */ }
    }

    var stepContent = null;
    if (wizardStep.key === 'selectType') {
        stepContent = migrationData.buildDataSelectContent();
        // Force product and customer selectable regardless of cached migrationData status
        var readyCount = 0;
        for (var si = 0; si < stepContent.sections.length; si++) {
            var sec = stepContent.sections[si];
            if (sec.taskId === 'product' || sec.taskId === 'customer' || sec.taskId === 'order'
                || sec.taskId === 'catalog' || sec.taskId === 'shippingMethod' || sec.taskId === 'inventory'
                || sec.taskId === 'pricebook' || sec.taskId === 'taxation' || sec.taskId === 'store') {
                sec.selectable = true;
            }
            if (sec.selectable) readyCount++;
        }
        stepContent.summary = readyCount + ' data type(s) ready';
    }

    var exportPhaseIds = [];
    var phasesForCfg   = migrationData.getOrderExportPhases();
    for (var pi = 0; pi < phasesForCfg.length; pi++) {
        exportPhaseIds.push(phasesForCfg[pi].id);
    }

    var dataWizardMsgs = {
        connectionFailed:       Resource.msg('accelerator.datawizard.connectionFailed', 'accelerator', null),
        connectionSuccess:      Resource.msg('accelerator.datawizard.connectionSuccess', 'accelerator', null),
        selectTypeCountSuffix:  Resource.msg('accelerator.datawizard.selectType.countSuffix', 'accelerator', null),
        selectTypeNoneSelected: Resource.msg('accelerator.datawizard.selectType.noneSelected', 'accelerator', null),
        exportRunning:          Resource.msg('accelerator.ordermigration.export.running', 'accelerator', null),
        exportFailed:           Resource.msg('accelerator.ordermigration.export.failed', 'accelerator', null),
        exportComplete:         Resource.msg('accelerator.ordermigration.export.complete', 'accelerator', null),
        orderCountLoading:      Resource.msg('accelerator.ordermigration.count.loading', 'accelerator', null),
        orderCountPrompt:       Resource.msg('accelerator.ordermigration.count.prompt', 'accelerator', null),
        orderCountError:        Resource.msg('accelerator.ordermigration.count.error', 'accelerator', null),
        orderCountNone:         Resource.msg('accelerator.ordermigration.count.none', 'accelerator', null),
        orderCountMatch:        Resource.msg('accelerator.ordermigration.count.match', 'accelerator', null),
        orderCountExport:       Resource.msg('accelerator.ordermigration.count.export', 'accelerator', null)
    };

    var wizardBaseUrl = URLUtils.url('Accelerator-DataWizard', 'platform', platform.id).toString();
    var exportPhaseCsv = exportPhaseIds.join(',');

    var dataWizardPages = {
        connect:        'accelerator/dataWizardConnect',
        selectType:     'accelerator/dataWizardSelectType',
        orderConfigure: 'accelerator/dataWizardOrderConfigure',
        orderExport:    'accelerator/dataWizardOrderExport',
        orderReview:    'accelerator/dataWizardOrderReview',
        typePlaceholder:'accelerator/dataWizardTypePlaceholder'
    };

    var diagParam = getParam('diag');
    var pageTemplate = dataWizardPages[wizardStep.key] || dataWizardPages.typePlaceholder;
    if (diagParam === 'shell') {
        pageTemplate = 'accelerator/dataWizardDiag';
    }

    ISML.renderTemplate(pageTemplate, withBmFrame({
        title:               Resource.msg('accelerator.datawizard.title', 'accelerator', null),
        subtitle:            Resource.msg('accelerator.subtitle', 'accelerator', null),
        platform:            platform,
        dataTypeId:          dataTypeId,
        dataType:            migrationData.getDataType(dataTypeId),
        wizardSteps:         migrationData.getDataWizardSteps(dataTypeId),
        exportPhases:        migrationData.getOrderExportPhases(),
        currentStep:         currentStep,
        wizardStep:          wizardStep,
        wizardStepKey:       String(wizardStep.key),
        exportPhaseCsv:      exportPhaseCsv,
        stepContent:         stepContent,
        msgConnectionFailed:      dataWizardMsgs.connectionFailed,
        msgConnectionSuccess:     dataWizardMsgs.connectionSuccess,
        msgSelectTypeCountSuffix: dataWizardMsgs.selectTypeCountSuffix,
        msgSelectTypeNoneSelected: dataWizardMsgs.selectTypeNoneSelected,
        msgExportRunning:         dataWizardMsgs.exportRunning,
        msgExportFailed:          dataWizardMsgs.exportFailed,
        msgExportComplete:        dataWizardMsgs.exportComplete,
        msgOrderCountLoading:     dataWizardMsgs.orderCountLoading,
        msgOrderCountPrompt:      dataWizardMsgs.orderCountPrompt,
        msgOrderCountError:       dataWizardMsgs.orderCountError,
        msgOrderCountNone:        dataWizardMsgs.orderCountNone,
        msgOrderCountMatch:       dataWizardMsgs.orderCountMatch,
        msgOrderCountExport:      dataWizardMsgs.orderCountExport,
        orderReport:         orderReport,
        bmImpexUrl:          bmImpexUrl,
        orderYears:          String(session.custom.orderExportYears || '1'),
        orderMaxCount:       String(session.custom.orderExportMaxCount || ''),
        orderOrderState:     String(session.custom.orderExportOrderState || ''),
        orderPaymentState:   String(session.custom.orderExportPaymentState || ''),
        orderStateFilters:   migrationData.getCtpOrderStateFilters(),
        paymentStateFilters: migrationData.getCtpPaymentStateFilters(),
        prevStep:            prevStep,
        nextStep:            nextStep,
        prevStepQuery:       toStepQuery(prevStep),
        nextStepQuery:       toStepQuery(nextStep),
        isLastStep:          currentStep >= maxStep,
        dashboardUrl:        URLUtils.url('Accelerator-Start').toString(),
        dataWizardSelectUrl: dataMigrationSession.dataWizardSelectUrl(platformId),
        hideDataSelectionBack: wizardStep.key === 'connect' || wizardStep.key === 'selectType',
        dataWizardEntryUrl:  dataMigrationSession.dataWizardUrl(platformId),
        wizardBaseUrl:       wizardBaseUrl,
        continueUrl:         URLUtils.url('Accelerator-DataWizardContinue').toString(),
        orderConfigUrl:      URLUtils.url('Accelerator-DataWizardSaveOrderConfig').toString(),
        testConnectionUrl:   URLUtils.url('Accelerator-TestConnection').toString(),
        exportUrl:           URLUtils.url('Accelerator-ExportOrders').toString(),
        orderCountUrl:       URLUtils.url('Accelerator-CountOrders').toString(),
        checkAttrsUrl:       URLUtils.url('Accelerator-CheckOrderAttributes').toString(),
        createAttrsUrl:      URLUtils.url('Accelerator-CreateOrderAttributes').toString(),
        downloadUrl:         URLUtils.url('Accelerator-DownloadMigrationFile').toString(),
        categoryMigrationUrl: URLUtils.url('Accelerator-CategoryMigration').toString(),
        dataWizardJsUrl:     URLUtils.staticURL('/js/data-wizard.js').toString(),
        attrPreflightJsUrl:  URLUtils.staticURL('/js/attr-preflight.js').toString(),
        cssUrl:              URLUtils.staticURL('/css/accelerator-migration.css').toString()
    }));
};
exports.DataWizard.public = true;

/**
 * Validate connection on Continue (form POST) and advance to data type selection.
 */
exports.DataWizardContinue = function () {
    var platformId = getParam('platformId') || getParam('platform') || 'commercetools';
    var connector  = registry.get(platformId);
    var stepOneUrl = URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '1');
    var stepTwoUrl = URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '2');

    if (!connector) {
        response.redirect(stepOneUrl);
        return;
    }

    try {
        var result = connector.testConnectionWith(buildConnectionCreds(platformId));
        dataMigrationSession.markConnected(platformId, result.expiresIn);

        if (platformId === 'shopify') {
            var creds = buildConnectionCreds(platformId);
            session.custom.shopifyStoreUrl     = creds.storeUrl     || '';
            session.custom.shopifyClientId     = creds.clientId     || '';
            session.custom.shopifyClientSecret = creds.clientSecret || '';
            session.custom.shopifyApiVersion   = creds.apiVersion   || '2025-01';
        }

        response.redirect(stepTwoUrl);
    } catch (e) {
        dataMigrationSession.clearConnection();
        response.redirect(stepOneUrl);
    }
};
exports.DataWizardContinue.public = true;

/**
 * Select a data type and advance into its migration steps.
 */
exports.DataWizardSelectType = function () {
    var platformId = getParam('platform') || String(session.custom.migrationPlatformId || 'commercetools');
    var typeId     = getParam('type');

    if (!isDataMigrationConnected()) {
        response.redirect(URLUtils.url(
            'Accelerator-DataWizard',
            'platform', platformId,
            'step', dataMigrationSession.connectOrSelectStep()
        ));
        return;
    }

    if (!migrationData.getDataType(typeId)) {
        response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '2'));
        return;
    }

    session.custom.selectedDataType = typeId;

    // Types with dedicated migration pages bypass the typePlaceholder and go directly.
    if (typeId === 'customer') {
        response.redirect(URLUtils.url('Accelerator-CustomerMigration'));
        return;
    }
    if (typeId === 'shippingMethod') {
        response.redirect(URLUtils.url('Accelerator-ShippingMethodMigration'));
        return;
    }
    if (typeId === 'inventory') {
        response.redirect(URLUtils.url('Accelerator-InventoryMigration'));
        return;
    }
    if (typeId === 'pricebook') {
        response.redirect(URLUtils.url('Accelerator-PricebookMigration'));
        return;
    }
    if (typeId === 'taxation') {
        response.redirect(URLUtils.url('Accelerator-TaxMigration'));
        return;
    }
    if (typeId === 'store') {
        response.redirect(URLUtils.url('Accelerator-StoreMigration'));
        return;
    }
    if (typeId === 'product') {
        response.redirect(URLUtils.url('Accelerator-ProductWizard'));
        return;
    }
    if (typeId === 'catalog') {
        response.redirect(URLUtils.url('Accelerator-CategoryMigration'));
        return;
    }

    response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '3'));
};
exports.DataWizardSelectType.public = true;

/**
 * Save order export configuration and advance to export step.
 */
exports.DataWizardSaveOrderConfig = function () {
    var platformId = getParam('platformId') || getParam('platform') || String(session.custom.migrationPlatformId || 'commercetools');
    var years      = parseInt(getParam('years') || '1', 10);
    var maxRaw     = getParam('maxCount');
    var orderState   = getParam('orderState') || '';
    var paymentState = getParam('paymentState') || '';
    var stepThree  = URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '3');
    var stepFour   = URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '4');

    if (session.custom.selectedDataType !== 'order') {
        response.redirect(stepThree);
        return;
    }

    if ([1, 2, 3].indexOf(years) < 0) {
        response.redirect(stepThree);
        return;
    }

    if (!migrationData.isValidCtpOrderState(orderState) || !migrationData.isValidCtpPaymentState(paymentState)) {
        response.redirect(stepThree);
        return;
    }

    session.custom.orderExportYears         = String(years);
    session.custom.orderExportMaxCount      = maxRaw ? String(parseInt(maxRaw, 10)) : '';
    session.custom.orderExportOrderState    = orderState;
    session.custom.orderExportPaymentState  = paymentState;
    response.redirect(stepFour);
};
exports.DataWizardSaveOrderConfig.public = true;

/**
 * Placeholder for data migration flows not yet implemented.
 */
exports.DataMigrationFlow = function () {
    var platformId = getParam('platform') || String(session.custom.migrationPlatformId || 'commercetools');
    var typeId     = getParam('type');

    if (!isDataMigrationConnected()) {
        response.redirect(URLUtils.url(
            'Accelerator-DataWizard',
            'platform', platformId,
            'step', dataMigrationSession.connectOrSelectStep()
        ));
        return;
    }

    if (typeId) {
        session.custom.selectedDataType = typeId;
    }

    response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '3'));
};
exports.DataMigrationFlow.public = true;

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

    ISML.renderTemplate('accelerator/wizard', withBmFrame({
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
        dataWizardSelectUrl: dataMigrationSession.dataWizardSelectUrl(platformId),
        wizardBaseUrl: URLUtils.url('Accelerator-Wizard', 'platform', platform.id).toString(),
        cssUrl:        URLUtils.staticURL('/css/accelerator-migration.css').toString()
    }));
};
exports.Wizard.public = true;

// ─── Customer data migration ──────────────────────────────────────────────────

/**
 * Customer migration page — standalone, separate from the schema wizard.
 */
exports.CustomerMigration = function () {
    var cfg2           = require('*/cartridge/scripts/migration/configAccessor');
    var Site           = require('dw/system/Site');
    var customerListId = (cfg2.sfcc && cfg2.sfcc.customerListId) ? cfg2.sfcc.customerListId : '';
    var siteId         = Site.getCurrent().getID();
    var jobsUrl        = 'https://' + request.httpHost
                       + '/on/demandware.store/Sites-Site/default;site=' + siteId
                       + '/ViewApplication-BM?SelectedMenuItem=jobschedules'
                       + '#/?job#editor!id!CTCustomer!config!CTCustomer!domain!Sites';
    var platformId = String(session.custom.migrationPlatformId || 'commercetools');
    var pageCtx    = migrationPageContext(platformId, 'customer');
    var listsUrl   = URLUtils.url('Accelerator-GetCustomerLists').toString();
    ISML.renderTemplate('accelerator/customerMigration', withBmFrame({
        title:          Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:       Resource.msg('accelerator.subtitle', 'accelerator', null),
        customerListId: customerListId,
        dashboardUrl:   URLUtils.url('Accelerator-Start').toString(),
        impexPath:      pageCtx.impexPath,
        impexUrl:       pageCtx.impexUrl,
        dataWizardEntryUrl:  pageCtx.dataWizardEntryUrl,
        dataWizardSelectUrl: pageCtx.dataWizardSelectUrl,
        dataWizardEntryUrlJs: toJsLiteral(pageCtx.dataWizardEntryUrl),
        customerListsUrlJs:   toJsLiteral(listsUrl),
        presetListIdJs:       toJsLiteral(customerListId),
        cssUrl:              URLUtils.staticURL('/css/accelerator-migration.css').toString(),
        attrPreflightJsUrl:  URLUtils.staticURL('/js/attr-preflight.js').toString(),
        countUrl:       URLUtils.url('Accelerator-CustomerMigrationCount').toString(),
        profileUrl:     URLUtils.url('Accelerator-MigrateCustomerBatch').toString(),
        addressUrl:     URLUtils.url('Accelerator-MigrateCustomerAddresses').toString(),
        fullBatchUrl:        URLUtils.url('Accelerator-FullMigrationBuildBatch').toString(),
        byIdUrl:             URLUtils.url('Accelerator-MigrateCustomerById').toString(),
        customerListsUrl:    listsUrl,
        checkAttrsUrl:       URLUtils.url('Accelerator-CheckCustomerAttributes').toString(),
        createAttrsUrl:      URLUtils.url('Accelerator-CreateCustomerAttributes').toString(),
        deleteAttrUrl:       URLUtils.url('Accelerator-DeleteCustomerAttribute').toString(),
        jobsUrl:             jobsUrl
    }));
};
exports.CustomerMigration.public = true;

/**
 * Return all SFCC customer list IDs available on the instance.
 * GET — no params required.
 */
exports.GetCustomerLists = function () {
    try {
        var sfccClientSites = require('*/cartridge/scripts/migration/sfccClient');
        var token           = sfccClientSites.getSFCCToken();
        var s               = sfccClientSites.getSFCCSettings();
        var url             = s.baseUrl + '/s/-/dw/data/' + s.metaVersion
                            + '/sites?client_id=' + encodeURIComponent(s.bmClientId);
        var res             = sfccClientSites.doGet(url, token);

        if (res.status !== 200) {
            jsonResponse({ ok: false, error: 'HTTP ' + res.status });
            return;
        }

        var seen   = {};
        var result = [];
        var data   = (res.data && res.data.data) ? res.data.data : [];
        for (var i = 0; i < data.length; i++) {
            var site   = data[i];
            var link   = site.customer_list_link;
            var listId = (link && link.customer_list_id)
                      || site.customer_list_id
                      || site.id;
            if (listId && !seen[listId]) {
                seen[listId] = true;
                result.push({ id: listId });
            }
        }
        jsonResponse({ ok: true, lists: result });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.GetCustomerLists.public = true;

/**
 * Return all SFCC catalog IDs available on the instance.
 * GET — no params required.
 */
exports.GetProductCatalogs = function () {
    exports.FetchSFCCCatalogs();
};
exports.GetProductCatalogs.public = true;

/**
 * GET: fileName=<name> — streams XML file from IMPEX as a download.
 */
exports.DownloadProductXml = function () {
    var fileName = getParam('fileName') || '';
    if (!fileName || !/^[a-zA-Z0-9_\-]+\.xml$/.test(fileName)) {
        response.setContentType('text/plain');
        response.writer.print('Invalid or missing fileName parameter.');
        return;
    }
    var File       = require('dw/io/File');
    var FileReader = require('dw/io/FileReader');
    var sep        = File.SEPARATOR;
    var file       = new File(File.IMPEX + sep + 'src' + sep + 'migration' + sep + 'product' + sep + fileName);
    if (!file.exists()) {
        response.setContentType('text/plain');
        response.writer.print('File not found: ' + fileName);
        return;
    }
    response.setContentType('application/xml');
    response.addHttpHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
    var reader = new FileReader(file, 'UTF-8');
    try {
        var line;
        while ((line = reader.readLine()) !== null) {
            response.writer.println(line);
        }
    } finally {
        reader.close();
    }
};
exports.DownloadProductXml.public = true;

/**
 * GET — Returns all CTP variant product attributes plus the saved selection from session.
 * Response: { ok, attrs: [{ name, sfccId, label, ctpType }], savedSelection: [string]|null }
 */
/**
 * GET — Returns CTP product types detected as Product Sets, with product count per type.
 * Response: { ok, sets: [{ typeId, typeName, refAttrName, count }] }
 */
exports.GetProductSetsInfo = function () {
    try {
        var scanner = require('*/cartridge/scripts/migration/productMigration/ctpProductTypeScanner');
        jsonResponse({ ok: true, sets: scanner.getProductSetsSummary() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.GetProductSetsInfo.public = true;

/**
 * GET — Returns CTP product types detected as Bundle Products, with product count per type.
 * Response: { ok, bundles: [{ typeId, typeName, refAttrName, quantityAttrName, count }] }
 */
exports.GetBundleProductsInfo = function () {
    try {
        var scanner = require('*/cartridge/scripts/migration/productMigration/ctpProductTypeScanner');
        jsonResponse({ ok: true, bundles: scanner.getBundleProductsSummary() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.GetBundleProductsInfo.public = true;

exports.GetVariantAttrs = function () {
    try {
        var checker    = require('*/cartridge/scripts/migration/productMigration/productAttrChecker');
        var sfccClient = require('*/cartridge/scripts/migration/sfccClient');
        var fields     = checker.getCtpProductTypeFields();

        var existingIds = {};
        try {
            var tok     = sfccClient.getSFCCToken();
            existingIds = sfccClient.getExistingAttributeIds(tok, 'Product') || {};
        } catch (se) {}

        var enriched = [];
        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            enriched.push({
                name:         f.name,
                sfccId:       f.sfccId,
                label:        f.label,
                ctpType:      f.ctpType,
                existsInSfcc: !!existingIds[f.sfccId]
            });
        }

        var savedRaw       = String(session.custom.selectedVariantAttrs || '');
        var savedSelection = null;
        if (savedRaw) {
            try { savedSelection = JSON.parse(savedRaw); } catch (pe) {}
        }
        jsonResponse({ ok: true, attrs: enriched, savedSelection: savedSelection });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.GetVariantAttrs.public = true;

/**
 * POST: attrs=<JSON array of SFCC attr IDs authorized by the user in the pre-flight panel>
 * Saves the pre-flight authorization list to session. No attribute creation happens here.
 */
exports.SavePreflightSelection = function () {
    try {
        var attrsJson = getParam('attrs');
        var attrs = [];
        if (attrsJson) { try { attrs = JSON.parse(attrsJson); } catch (pe) {} }
        session.custom.preflightSelection = JSON.stringify(attrs);
        jsonResponse({ ok: true, authorized: attrs.length });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.SavePreflightSelection.public = true;

/**
 * POST: attrs=<JSON array of CTP attr names to include in variant XML>
 * Validates, auto-creates missing SFCC attrs (if pre-flight authorized), then saves selection.
 *
 * Rules:
 *  - Attr exists in SFCC → include directly, no pre-flight needed
 *  - Attr missing in SFCC + pre-flight authorized → create it, then include
 *  - Attr missing in SFCC + NOT pre-flight authorized → validation error
 */
exports.SaveVariantAttrSelection = function () {
    try {
        var attrsJson = getParam('attrs');
        var selected  = [];
        if (attrsJson) { try { selected = JSON.parse(attrsJson); } catch (pe) {} }

        var checker    = require('*/cartridge/scripts/migration/productMigration/productAttrChecker');
        var sfccClient = require('*/cartridge/scripts/migration/sfccClient');

        // Build ctpName → sfccId map
        var ctpFields      = checker.getCtpProductTypeFields();
        var ctpNameToField = {};
        for (var fi = 0; fi < ctpFields.length; fi++) {
            ctpNameToField[ctpFields[fi].name] = ctpFields[fi];
        }

        // Check which attrs currently exist in SFCC (best-effort — if OCAPI fails, skip validation)
        var existingIds = null;
        try {
            var tok = sfccClient.getSFCCToken();
            existingIds = sfccClient.getExistingAttributeIds(tok, 'Product') || {};
        } catch (se) {}

        // Validate only when OCAPI call succeeded (existingIds is not null)
        if (existingIds !== null && Object.keys(existingIds).length > 0) {
            var notInSfcc = [];
            for (var si = 0; si < selected.length; si++) {
                var field = ctpNameToField[selected[si]];
                if (field && !existingIds[field.sfccId]) {
                    notInSfcc.push(selected[si]);
                }
            }
            if (notInSfcc.length) {
                jsonResponse({ ok: false, validationError: true, notInSfcc: notInSfcc });
                return;
            }
        }

        session.custom.selectedVariantAttrs = JSON.stringify(selected);
        jsonResponse({ ok: true });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.SaveVariantAttrSelection.public = true;

/**
 * Compare CTP customer custom fields against SFCC Customer attribute definitions.
 * Returns attributes present in CTP but missing in SFCC.
 * GET — no params required.
 */
exports.CheckCustomerAttributes = function () {
    try {
        var checker = require('*/cartridge/scripts/migration/customerMigration/customerAttrChecker');
        jsonResponse({ ok: true, missing: checker.checkMissingAttributes() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CheckCustomerAttributes.public = true;

/**
 * Create selected attribute definitions on the SFCC Customer system object.
 * POST: attrs=<json-array of {id, label, sfccType}>
 */
exports.CreateCustomerAttributes = function () {
    var rawAttrs = getParam('attrs');
    var attrs    = [];
    try { attrs = JSON.parse(rawAttrs || '[]'); } catch (e) {
        jsonResponse({ ok: false, error: 'Invalid attrs JSON' });
        return;
    }
    if (!attrs.length) {
        jsonResponse({ ok: false, error: 'No attributes provided' });
        return;
    }
    try {
        var checker2 = require('*/cartridge/scripts/migration/customerMigration/customerAttrChecker');
        jsonResponse({ ok: true, result: checker2.createAttributes(attrs) });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CreateCustomerAttributes.public = true;

/**
 * Delete a single custom attribute definition from the SFCC Profile system object.
 * POST: attrId=<attribute-id>
 */
exports.DeleteCustomerAttribute = function () {
    var attrId = getParam('attrId');
    if (!attrId) {
        jsonResponse({ ok: false, error: 'attrId is required' });
        return;
    }
    try {
        var sfccClientDel = require('*/cartridge/scripts/migration/sfccClient');
        var tokenDel      = sfccClientDel.getSFCCToken();
        sfccClientDel.deleteAttributeDefinition(tokenDel, 'Profile', attrId);
        jsonResponse({ ok: true });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.DeleteCustomerAttribute.public = true;

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

// ─── Shipping method data migration ───────────────────────────────────────────

/**
 * Shipping method migration page — site-specific, mirrors customer migration flow.
 */
exports.ShippingMethodMigration = function () {
    var Site      = require('dw/system/Site');
    var siteId    = Site.getCurrent().getID();
    var platformId = String(session.custom.migrationPlatformId || 'commercetools');
    var pageCtx    = migrationPageContext(platformId, 'shippingMethod');
    var jobsUrl = 'https://' + request.httpHost
        + '/on/demandware.store/Sites-Site/default;site=' + siteId
        + '/ViewApplication-BM?SelectedMenuItem=site-obj_impex'
        + '#/?impex#import';

    ISML.renderTemplate('accelerator/shippingMethodMigration', withBmFrame({
        title:        Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:     Resource.msg('accelerator.subtitle', 'accelerator', null),
        presetSiteId: siteId,
        impexPath:    pageCtx.impexPath,
        dashboardUrl: URLUtils.url('Accelerator-Start').toString(),
        dataWizardEntryUrl:  pageCtx.dataWizardEntryUrl,
        dataWizardSelectUrl: pageCtx.dataWizardSelectUrl,
        impexUrl:     pageCtx.impexUrl,
        cssUrl:       URLUtils.staticURL('/css/accelerator-migration.css').toString(),
        attrPreflightJsUrl: URLUtils.staticURL('/js/attr-preflight.js').toString(),
        countUrl:          URLUtils.url('Accelerator-ShippingMethodMigrationCount').toString(),
        listMethodsUrl:    URLUtils.url('Accelerator-ListShippingMethods').toString(),
        fullBatchUrl:      URLUtils.url('Accelerator-FullShippingMethodBuildBatch').toString(),
        sitesUrl:          URLUtils.url('Accelerator-GetSites').toString(),
        checkAttrsUrl:     URLUtils.url('Accelerator-CheckShippingMethodAttributes').toString(),
        createAttrsUrl:    URLUtils.url('Accelerator-CreateShippingMethodAttributes').toString(),
        deleteAttrUrl:     URLUtils.url('Accelerator-DeleteShippingMethodAttribute').toString(),
        jobsUrl:           jobsUrl
    }));
};
exports.ShippingMethodMigration.public = true;

/**
 * Return all SFCC site IDs available on the instance.
 * GET — no params required.
 */
exports.GetSites = function () {
    try {
        var sfccClientSites = require('*/cartridge/scripts/migration/sfccClient');
        var token           = sfccClientSites.getSFCCToken();
        var s               = sfccClientSites.getSFCCSettings();
        var HTTPClientSites = require('dw/net/HTTPClient');
        var client          = new HTTPClientSites();
        var url             = s.baseUrl + '/s/-/dw/data/' + s.metaVersion
            + '/sites?client_id=' + encodeURIComponent(s.bmClientId);

        client.setTimeout(15000);
        client.open('GET', url);
        client.setRequestHeader('Authorization', 'Bearer ' + token);
        client.send('');

        var sc   = client.getStatusCode();
        var body = {};
        try { body = JSON.parse(client.getText() || '{}'); } catch (pe) {}

        if (sc !== 200) {
            jsonResponse({ ok: false, error: 'HTTP ' + sc });
            return;
        }

        var result = [];
        var seen   = {};
        var data   = body.data || [];
        for (var i = 0; i < data.length; i++) {
            var siteId = data[i].id;
            if (siteId && !seen[siteId]) {
                seen[siteId] = true;
                result.push({ id: siteId });
            }
        }
        jsonResponse({ ok: true, sites: result });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.GetSites.public = true;

exports.CheckShippingMethodAttributes = function () {
    try {
        var checker = require('*/cartridge/scripts/migration/shippingMethodMigration/shippingMethodAttrChecker');
        jsonResponse({ ok: true, missing: checker.checkMissingAttributes() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CheckShippingMethodAttributes.public = true;

exports.CreateShippingMethodAttributes = function () {
    var rawAttrs = getParam('attrs');
    var attrs    = [];
    try { attrs = JSON.parse(rawAttrs || '[]'); } catch (e) {
        jsonResponse({ ok: false, error: 'Invalid attrs JSON' });
        return;
    }
    if (!attrs.length) {
        jsonResponse({ ok: false, error: 'No attributes provided' });
        return;
    }
    try {
        var checker2 = require('*/cartridge/scripts/migration/shippingMethodMigration/shippingMethodAttrChecker');
        jsonResponse({ ok: true, result: checker2.createAttributes(attrs) });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CreateShippingMethodAttributes.public = true;

exports.DeleteShippingMethodAttribute = function () {
    var attrId = getParam('attrId');
    if (!attrId) {
        jsonResponse({ ok: false, error: 'attrId is required' });
        return;
    }
    try {
        var sfccClientDel = require('*/cartridge/scripts/migration/sfccClient');
        var tokenDel      = sfccClientDel.getSFCCToken();
        sfccClientDel.deleteAttributeDefinition(tokenDel, 'ShippingMethod', attrId);
        jsonResponse({ ok: true });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.DeleteShippingMethodAttribute.public = true;

exports.ShippingMethodMigrationCount = function () {
    try {
        var ctpFetcher = require('*/cartridge/scripts/migration/shippingMethodMigration/ctpShippingMethodFetcher');
        jsonResponse({ ok: true, total: ctpFetcher.getCount() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.ShippingMethodMigrationCount.public = true;

/**
 * List all CTP shipping methods for the migration checklist UI.
 * GET — no params required.
 */
exports.ListShippingMethods = function () {
    try {
        var fetcher     = require('*/cartridge/scripts/migration/shippingMethodMigration/ctpShippingMethodFetcher');
        var transformer = require('*/cartridge/scripts/migration/shippingMethodMigration/shippingMethodTransformer');
        var batch       = fetcher.fetchAll();
        var list        = [];

        for (var i = 0; i < batch.methods.length; i++) {
            list.push(transformer.toSummary(batch.methods[i]));
        }

        jsonResponse({ ok: true, total: batch.total, methods: list });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.ListShippingMethods.public = true;

exports.FullShippingMethodBuildBatch = function () {
    var offset  = parseInt(getParam('offset') || '0', 10);
    var siteId  = getParam('siteId');
    var rawKeys = getParam('keys');

    if (!siteId) {
        jsonResponse({ ok: false, error: 'siteId is required' });
        return;
    }

    var keys = null;
    if (rawKeys) {
        try { keys = JSON.parse(rawKeys); } catch (e) {
            jsonResponse({ ok: false, error: 'Invalid keys JSON' });
            return;
        }
    }

    try {
        var fullRunner = require('*/cartridge/scripts/migration/shippingMethodMigration/fullMigrationRunner');
        if (keys && keys.length) {
            jsonResponse(fullRunner.runBatchForKeys(keys, offset, siteId));
        } else {
            jsonResponse(fullRunner.runBatch(offset, siteId));
        }
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.FullShippingMethodBuildBatch.public = true;

// ─── Inventory list data migration ────────────────────────────────────────────

/**
 * Inventory list migration page — mirrors shipping method flow without entity checklist.
 */
exports.InventoryMigration = function () {
    var cfg2           = require('*/cartridge/scripts/migration/configAccessor');
    var Site           = require('dw/system/Site');
    var siteId         = Site.getCurrent().getID();
    var listId         = (cfg2.sfcc && cfg2.sfcc.inventoryListId) ? cfg2.sfcc.inventoryListId : '';
    var platformId     = String(session.custom.migrationPlatformId || 'commercetools');
    var pageCtx        = migrationPageContext(platformId, 'inventory');
    var jobsUrl        = 'https://' + request.httpHost
        + '/on/demandware.store/Sites-Site/default;site=' + siteId
        + '/ViewApplication-BM?SelectedMenuItem=site-obj_impex'
        + '#/?impex#import';

    ISML.renderTemplate('accelerator/inventoryMigration', withBmFrame({
        title:               Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:            Resource.msg('accelerator.subtitle', 'accelerator', null),
        presetListId:        listId,
        impexPath:           pageCtx.impexPath,
        dashboardUrl:        URLUtils.url('Accelerator-Start').toString(),
        dataWizardEntryUrl:  pageCtx.dataWizardEntryUrl,
        dataWizardSelectUrl: pageCtx.dataWizardSelectUrl,
        countUrl:            URLUtils.url('Accelerator-InventoryMigrationCount').toString(),
        fullBatchUrl:        URLUtils.url('Accelerator-FullInventoryBuildBatch').toString(),
        supplyChannelsUrl:   URLUtils.url('Accelerator-GetSupplyChannels').toString(),
        checkAttrsUrl:       URLUtils.url('Accelerator-CheckInventoryAttributes').toString(),
        createAttrsUrl:      URLUtils.url('Accelerator-CreateInventoryAttributes').toString(),
        impexUrl:            pageCtx.impexUrl,
        cssUrl:              URLUtils.staticURL('/css/accelerator-migration.css').toString(),
        attrPreflightJsUrl:  URLUtils.staticURL('/js/attr-preflight.js').toString(),
        inventoryMigrationJsUrl: URLUtils.staticURL('/js/inventory-migration.js').toString() + '?v=5',
        jobsUrl:             jobsUrl
    }));
};
exports.InventoryMigration.public = true;

/**
 * Return CTP inventory supply channels for optional filtering.
 * GET — no params required.
 */
exports.GetSupplyChannels = function () {
    try {
        var fetcher = require('*/cartridge/scripts/migration/inventoryMigration/ctpInventoryFetcher');
        jsonResponse({ ok: true, channels: fetcher.fetchSupplyChannels() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.GetSupplyChannels.public = true;

exports.CheckInventoryAttributes = function () {
    try {
        var checker = require('*/cartridge/scripts/migration/inventoryMigration/inventoryAttrChecker');
        jsonResponse({ ok: true, missing: checker.checkMissingAttributes() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CheckInventoryAttributes.public = true;

exports.CreateInventoryAttributes = function () {
    var rawAttrs = getParam('attrs');
    var attrs    = [];
    try { attrs = JSON.parse(rawAttrs || '[]'); } catch (e) {
        jsonResponse({ ok: false, error: 'Invalid attrs JSON' });
        return;
    }
    if (!attrs.length) {
        jsonResponse({ ok: false, error: 'No attributes provided' });
        return;
    }
    try {
        var checker2 = require('*/cartridge/scripts/migration/inventoryMigration/inventoryAttrChecker');
        jsonResponse({ ok: true, result: checker2.createAttributes(attrs) });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CreateInventoryAttributes.public = true;

exports.DeleteInventoryAttribute = function () {
    var attrId = getParam('attrId');
    if (!attrId) {
        jsonResponse({ ok: false, error: 'attrId is required' });
        return;
    }
    try {
        var sfccClientDel = require('*/cartridge/scripts/migration/sfccClient');
        var tokenDel      = sfccClientDel.getSFCCToken();
        sfccClientDel.deleteAttributeDefinition(tokenDel, 'ProductInventoryRecord', attrId);
        jsonResponse({ ok: true });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.DeleteInventoryAttribute.public = true;

exports.InventoryMigrationCount = function () {
    try {
        var supplyChannelId = getParam('supplyChannelId');
        var ctpFetcher      = require('*/cartridge/scripts/migration/inventoryMigration/ctpInventoryFetcher');
        jsonResponse({ ok: true, total: ctpFetcher.getCount(supplyChannelId) });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.InventoryMigrationCount.public = true;

exports.FullInventoryBuildBatch = function () {
    var offset          = parseInt(getParam('offset') || '0', 10);
    var listId          = getParam('listId');
    var supplyChannelId = getParam('supplyChannelId');
    var exportKey       = getParam('exportKey');
    var fileName        = getParam('fileName');
    var aggregate       = getParam('aggregate') === 'true';

    if (!listId) {
        jsonResponse({ ok: false, error: 'listId is required' });
        return;
    }
    if (!exportKey) {
        jsonResponse({ ok: false, error: 'exportKey is required' });
        return;
    }

    try {
        var fullRunner = require('*/cartridge/scripts/migration/inventoryMigration/fullMigrationRunner');
        jsonResponse(fullRunner.runBatch(offset, listId, supplyChannelId, exportKey, fileName, aggregate));
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.FullInventoryBuildBatch.public = true;

// ─── Pricebook data migration ─────────────────────────────────────────────────

exports.PricebookMigration = function () {
    var Site           = require('dw/system/Site');
    var siteId         = Site.getCurrent().getID();
    var presetId       = 'list-prices';
    var platformId     = String(session.custom.migrationPlatformId || 'commercetools');
    var pageCtx        = migrationPageContext(platformId, 'pricebook');
    var jobsUrl        = 'https://' + request.httpHost
        + '/on/demandware.store/Sites-Site/default;site=' + siteId
        + '/ViewApplication-BM?SelectedMenuItem=site-obj_impex'
        + '#/?impex#import';

    ISML.renderTemplate('accelerator/pricebookMigration', withBmFrame({
        title:               Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:            Resource.msg('accelerator.subtitle', 'accelerator', null),
        presetPricebookId:   presetId,
        impexPath:           pageCtx.impexPath,
        dashboardUrl:        URLUtils.url('Accelerator-Start').toString(),
        dataWizardEntryUrl:  pageCtx.dataWizardEntryUrl,
        dataWizardSelectUrl: pageCtx.dataWizardSelectUrl,
        countUrl:            URLUtils.url('Accelerator-PricebookMigrationCount').toString(),
        fullBatchUrl:        URLUtils.url('Accelerator-FullPricebookBuildBatch').toString(),
        pricebooksUrl:       URLUtils.url('Accelerator-GetPricebooks').toString(),
        checkAttrsUrl:       URLUtils.url('Accelerator-CheckPricebookAttributes').toString(),
        createAttrsUrl:      URLUtils.url('Accelerator-CreatePricebookAttributes').toString(),
        impexUrl:            pageCtx.impexUrl,
        cssUrl:              URLUtils.staticURL('/css/accelerator-migration.css').toString(),
        attrPreflightJsUrl:  URLUtils.staticURL('/js/attr-preflight.js').toString(),
        pricebookMigrationJsUrl: URLUtils.staticURL('/js/pricebook-migration.js').toString() + '?v=5',
        jobsUrl:             jobsUrl
    }));
};
exports.PricebookMigration.public = true;

exports.GetPricebooks = function () {
    response.setContentType('application/json');
    var section = getParam('section') || 'standalone';
    var offset  = parseInt(getParam('offset') || '0', 10);
    var reset   = getParam('reset') === 'true';
    try {
        if (section === 'embedded') {
            var embeddedOnly = require('*/cartridge/scripts/migration/pricebookMigration/ctpEmbeddedPriceFetcher');
            var embResult    = embeddedOnly.discoverEmbeddedStep(offset, reset);
            jsonResponse({
                ok:           true,
                done:         embResult.done,
                nextOffset:   embResult.nextOffset,
                scanned:      embResult.scanned,
                total:        embResult.total,
                productTotal: embResult.productTotal,
                embedded:     embResult.embedded || []
            });
            return;
        }
        var fetcher   = require('*/cartridge/scripts/migration/pricebookMigration/ctpPricebookFetcher');
        var stdResult = fetcher.discoverStandaloneStep(offset, reset);
        jsonResponse({
            ok:         true,
            done:       stdResult.done,
            nextOffset: stdResult.nextOffset,
            scanned:    stdResult.scanned,
            total:      stdResult.total,
            standalone: stdResult.standalone || []
        });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.GetPricebooks.public = true;

exports.CheckPricebookAttributes = function () {
    try {
        var checker = require('*/cartridge/scripts/migration/pricebookMigration/pricebookAttrChecker');
        jsonResponse({ ok: true, missing: checker.checkMissingAttributes() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CheckPricebookAttributes.public = true;

exports.CreatePricebookAttributes = function () {
    var attrsRaw = getParam('attrs');
    if (!attrsRaw) {
        jsonResponse({ ok: false, error: 'attrs parameter is required' });
        return;
    }
    try {
        var attrs = JSON.parse(attrsRaw);
        var checker2 = require('*/cartridge/scripts/migration/pricebookMigration/pricebookAttrChecker');
        jsonResponse({ ok: true, result: checker2.createAttributes(attrs) });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CreatePricebookAttributes.public = true;

exports.PricebookMigrationCount = function () {
    response.setContentType('application/json');
    try {
        var source    = getParam('source') || 'standalone';
        var currency  = getParam('currency');
        var channelId = getParam('channelId');
        var aggregate = getParam('aggregate') === 'true';
        if (source === 'embedded') {
            var embedded = require('*/cartridge/scripts/migration/pricebookMigration/ctpEmbeddedPriceFetcher');
            jsonResponse({ ok: true, total: embedded.getPriceCount(currency, channelId, aggregate) });
            return;
        }
        var fetcher = require('*/cartridge/scripts/migration/pricebookMigration/ctpPricebookFetcher');
        jsonResponse({ ok: true, total: fetcher.getCount(currency, channelId, aggregate) });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.PricebookMigrationCount.public = true;

exports.FullPricebookBuildBatch = function () {
    response.setContentType('application/json');
    var offset       = parseInt(getParam('offset') || '0', 10);
    var pricebookId  = getParam('pricebookId');
    var currency     = getParam('currency');
    var channelId    = getParam('channelId');
    var exportKey    = getParam('exportKey');
    var fileName     = getParam('fileName');
    var aggregate    = getParam('aggregate') === 'true';
    var source       = getParam('source') || 'standalone';

    if (!pricebookId) {
        jsonResponse({ ok: false, error: 'pricebookId is required' });
        return;
    }
    if (!currency) {
        jsonResponse({ ok: false, error: 'currency is required' });
        return;
    }
    if (!exportKey) {
        jsonResponse({ ok: false, error: 'exportKey is required' });
        return;
    }

    try {
        var fullRunner = require('*/cartridge/scripts/migration/pricebookMigration/fullMigrationRunner');
        if (source === 'embedded') {
            jsonResponse(fullRunner.runEmbeddedBatch(
                offset, pricebookId, currency, channelId, exportKey, fileName, aggregate
            ));
            return;
        }
        jsonResponse(fullRunner.runBatch(
            offset, pricebookId, currency, channelId, exportKey, fileName, aggregate
        ));
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.FullPricebookBuildBatch.public = true;

// ─── Tax data migration ───────────────────────────────────────────────────────

exports.TaxMigration = function () {
    var Site           = require('dw/system/Site');
    var siteId         = Site.getCurrent().getID();
    var platformId     = String(session.custom.migrationPlatformId || 'commercetools');
    var pageCtx        = migrationPageContext(platformId, 'tax');
    var jobsUrl        = 'https://' + request.httpHost
        + '/on/demandware.store/Sites-Site/default;site=' + siteId
        + '/ViewApplication-BM?SelectedMenuItem=site-obj_impex'
        + '#/?impex#import';

    ISML.renderTemplate('accelerator/taxMigration', withBmFrame({
        title:               Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:            Resource.msg('accelerator.subtitle', 'accelerator', null),
        impexPath:           pageCtx.impexPath,
        dashboardUrl:        URLUtils.url('Accelerator-Start').toString(),
        dataWizardEntryUrl:  pageCtx.dataWizardEntryUrl,
        dataWizardSelectUrl: pageCtx.dataWizardSelectUrl,
        countUrl:            URLUtils.url('Accelerator-TaxMigrationCount').toString(),
        fullBatchUrl:        URLUtils.url('Accelerator-FullTaxBuildBatch').toString(),
        summaryUrl:          URLUtils.url('Accelerator-GetTaxSummary').toString(),
        checkAttrsUrl:       URLUtils.url('Accelerator-CheckTaxAttributes').toString(),
        createAttrsUrl:      URLUtils.url('Accelerator-CreateTaxAttributes').toString(),
        impexUrl:            pageCtx.impexUrl,
        cssUrl:              URLUtils.staticURL('/css/accelerator-migration.css').toString(),
        attrPreflightJsUrl:  URLUtils.staticURL('/js/attr-preflight.js').toString(),
        taxMigrationJsUrl:   URLUtils.staticURL('/js/tax-migration.js').toString() + '?v=6',
        jobsUrl:             jobsUrl
    }));
};
exports.TaxMigration.public = true;

exports.CheckTaxAttributes = function () {
    response.setContentType('application/json');
    try {
        var checker = require('*/cartridge/scripts/migration/taxMigration/taxAttrChecker');
        jsonResponse({ ok: true, missing: checker.checkMissingAttributes() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CheckTaxAttributes.public = true;

exports.CreateTaxAttributes = function () {
    response.setContentType('application/json');
    var rawAttrs = getParam('attrs');
    var attrs    = [];
    try { attrs = JSON.parse(rawAttrs || '[]'); } catch (e) {
        jsonResponse({ ok: false, error: 'Invalid attrs JSON' });
        return;
    }
    if (!attrs.length) {
        jsonResponse({ ok: false, error: 'No attributes provided' });
        return;
    }
    try {
        var checker = require('*/cartridge/scripts/migration/taxMigration/taxAttrChecker');
        jsonResponse({ ok: true, result: checker.createAttributes(attrs) });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CreateTaxAttributes.public = true;

exports.GetTaxSummary = function () {
    response.setContentType('application/json');
    try {
        var fetcher = require('*/cartridge/scripts/migration/taxMigration/ctpTaxFetcher');
        jsonResponse({ ok: true, overview: fetcher.getTaxOverview() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.GetTaxSummary.public = true;

exports.TaxMigrationCount = function () {
    response.setContentType('application/json');
    try {
        var scopeType = getParam('scopeType') || 'full';
        var scopeId   = getParam('scopeId') || '';
        var fetcher   = require('*/cartridge/scripts/migration/taxMigration/ctpTaxFetcher');
        jsonResponse({ ok: true, total: fetcher.getRateCount(scopeType, scopeId) });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.TaxMigrationCount.public = true;

exports.FullTaxBuildBatch = function () {
    response.setContentType('application/json');
    var offset     = parseInt(getParam('offset') || '0', 10);
    var exportKey  = getParam('exportKey');
    var scopeType  = getParam('scopeType') || 'full';
    var scopeId    = getParam('scopeId') || '';
    var fileName   = getParam('fileName');

    if (!exportKey) {
        jsonResponse({ ok: false, error: 'exportKey is required' });
        return;
    }

    try {
        var fullRunner = require('*/cartridge/scripts/migration/taxMigration/fullMigrationRunner');
        jsonResponse(fullRunner.runBatch(offset, exportKey, scopeType, scopeId, fileName));
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.FullTaxBuildBatch.public = true;

// ─── Store data migration ─────────────────────────────────────────────────────

exports.StoreMigration = function () {
    var Site           = require('dw/system/Site');
    var siteId         = Site.getCurrent().getID();
    var platformId     = String(session.custom.migrationPlatformId || 'commercetools');
    var pageCtx        = migrationPageContext(platformId, 'store');
    var jobsUrl        = 'https://' + request.httpHost
        + '/on/demandware.store/Sites-Site/default;site=' + siteId
        + '/ViewApplication-BM?SelectedMenuItem=site-obj_impex'
        + '#/?impex#import';

    ISML.renderTemplate('accelerator/storeMigration', withBmFrame({
        title:               Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:            Resource.msg('accelerator.subtitle', 'accelerator', null),
        impexPath:           pageCtx.impexPath,
        dashboardUrl:        URLUtils.url('Accelerator-Start').toString(),
        dataWizardEntryUrl:  pageCtx.dataWizardEntryUrl,
        dataWizardSelectUrl: pageCtx.dataWizardSelectUrl,
        fullBatchUrl:        URLUtils.url('Accelerator-FullStoreBuildBatch').toString(),
        listStoresUrl:       URLUtils.url('Accelerator-ListStores').toString(),
        checkAttrsUrl:       URLUtils.url('Accelerator-CheckStoreAttributes').toString(),
        createAttrsUrl:      URLUtils.url('Accelerator-CreateStoreAttributes').toString(),
        impexUrl:            pageCtx.impexUrl,
        cssUrl:              URLUtils.staticURL('/css/accelerator-migration.css').toString(),
        attrPreflightJsUrl:  URLUtils.staticURL('/js/attr-preflight.js').toString(),
        storeMigrationJsUrl: URLUtils.staticURL('/js/store-migration.js').toString() + '?v=4',
        jobsUrl:             jobsUrl
    }));
};
exports.StoreMigration.public = true;

exports.CheckStoreAttributes = function () {
    response.setContentType('application/json');
    try {
        var checker = require('*/cartridge/scripts/migration/storeMigration/storeAttrChecker');
        jsonResponse({ ok: true, missing: checker.checkMissingAttributes() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CheckStoreAttributes.public = true;

exports.CreateStoreAttributes = function () {
    response.setContentType('application/json');
    var rawAttrs = getParam('attrs');
    var attrs    = [];
    try { attrs = JSON.parse(rawAttrs || '[]'); } catch (e) {
        jsonResponse({ ok: false, error: 'Invalid attrs JSON' });
        return;
    }
    if (!attrs.length) {
        jsonResponse({ ok: false, error: 'No attributes provided' });
        return;
    }
    try {
        var checker = require('*/cartridge/scripts/migration/storeMigration/storeAttrChecker');
        jsonResponse({ ok: true, result: checker.createAttributes(attrs) });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CreateStoreAttributes.public = true;

exports.GetStoreSummary = function () {
    response.setContentType('application/json');
    try {
        var fetcher = require('*/cartridge/scripts/migration/storeMigration/ctpStoreFetcher');
        jsonResponse({ ok: true, summary: fetcher.getFullStoreSummary() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.GetStoreSummary.public = true;

/**
 * List all CTP stores for the migration checklist UI.
 * GET — no params required.
 */
exports.ListStores = function () {
    response.setContentType('application/json');
    try {
        var fetcher     = require('*/cartridge/scripts/migration/storeMigration/ctpStoreFetcher');
        var transformer = require('*/cartridge/scripts/migration/storeMigration/storeTransformer');
        var stores      = fetcher.fetchAllCtpStores();
        var list        = [];
        var i;

        for (i = 0; i < stores.length; i++) {
            list.push(transformer.toSummary(stores[i]));
        }

        jsonResponse({ ok: true, total: stores.length, stores: list });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.ListStores.public = true;

exports.StoreMigrationCount = function () {
    response.setContentType('application/json');
    try {
        var fetcher = require('*/cartridge/scripts/migration/storeMigration/ctpStoreFetcher');
        var summary = fetcher.getFullStoreSummary();
        jsonResponse({ ok: true, total: summary.storeCount || 0 });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.StoreMigrationCount.public = true;

exports.FullStoreBuildBatch = function () {
    response.setContentType('application/json');
    var offset    = parseInt(getParam('offset') || '0', 10);
    var exportKey = getParam('exportKey') || 'full';
    var fileName  = getParam('fileName');
    var rawKeys   = getParam('keys');

    var keys = null;
    if (rawKeys) {
        try { keys = JSON.parse(rawKeys); } catch (e) {
            jsonResponse({ ok: false, error: 'Invalid keys JSON' });
            return;
        }
    }

    try {
        var fullRunner = require('*/cartridge/scripts/migration/storeMigration/fullMigrationRunner');
        jsonResponse(fullRunner.runBatch(offset, exportKey, fileName, keys));
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.FullStoreBuildBatch.public = true;

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
    var platformId = String(session.custom.migrationPlatformId || 'commercetools');
    var pageCtx    = migrationPageContext(platformId, 'product');
    ISML.renderTemplate('accelerator/productMigration', withBmFrame({
        title:          Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:       Resource.msg('accelerator.subtitle', 'accelerator', null),
        impexPath:      pageCtx.impexPath,
        impexUrl:       pageCtx.impexUrl,
        dataWizardEntryUrl:  pageCtx.dataWizardEntryUrl,
        dataWizardSelectUrl: pageCtx.dataWizardSelectUrl,
        countUrl:       URLUtils.url('Accelerator-ProductMigrationCount').toString(),
        partialUrl:     URLUtils.url('Accelerator-MigrateProductById').toString(),
        fullBatchUrl:   URLUtils.url('Accelerator-FullProductMigrationBuildBatch').toString(),
        checkAttrsUrl:       URLUtils.url('Accelerator-CheckProductAttributes').toString(),
        createAttrsUrl:      URLUtils.url('Accelerator-CreateProductAttributes').toString(),
        deleteAttrUrl:       URLUtils.url('Accelerator-DeleteProductAttribute').toString(),
        catalogsUrl:         URLUtils.url('Accelerator-GetProductCatalogs').toString(),
        downloadXmlUrl:      URLUtils.url('Accelerator-DownloadProductXml').toString(),
        variantAttrsUrl:      URLUtils.url('Accelerator-GetVariantAttrs').toString(),
        saveVariantAttrsUrl:  URLUtils.url('Accelerator-SaveVariantAttrSelection').toString(),
        savePreflightUrl:     URLUtils.url('Accelerator-SavePreflightSelection').toString(),
        productSetsUrl:      URLUtils.url('Accelerator-GetProductSetsInfo').toString(),
        bundleProductsUrl:   URLUtils.url('Accelerator-GetBundleProductsInfo').toString(),
        dashboardUrl:        URLUtils.url('Accelerator-Start').toString(),
        cssUrl:              URLUtils.staticURL('/css/accelerator-migration.css').toString(),
        attrPreflightJsUrl:  URLUtils.staticURL('/js/attr-preflight.js').toString()
    }, 'rc_accelerator_product_wizard'));
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
 * Full Product Migration — fetch one batch of CTP products, build catalog XML, upload via WebDAV.
 * POST: offset=<n>
 * catalogId is read from config.js (sfcc.catalogId).
 */
exports.FullProductMigrationBuildBatch = function () {
    var offset    = parseInt(getParam('offset') || '0', 10);
    var migCfg    = require('*/cartridge/scripts/migration/configAccessor');
    var catalogId = getParam('catalogId')
                 || (migCfg.sfcc && migCfg.sfcc.catalogId ? String(migCfg.sfcc.catalogId) : '');

    if (!catalogId) {
        jsonResponse({ ok: false, error: 'sfcc.catalogId is not configured in config.js' });
        return;
    }
    var selectedVarAttrs = null;
    try {
        var raw = String(session.custom.selectedVariantAttrs || '');
        if (raw) { selectedVarAttrs = JSON.parse(raw); }
    } catch (pe) {}
    try {
        var prodRunner = require('*/cartridge/scripts/migration/productMigration/fullProductMigrationRunner');
        jsonResponse(prodRunner.runBatch(offset, catalogId, selectedVarAttrs));
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.FullProductMigrationBuildBatch.public = true;

/**
 * Partial Product Migration — fetch one CTP product by ID, build XML, upload via WebDAV.
 * POST: ctpId=<ctp-product-id>
 */
exports.MigrateProductById = function () {
    var ctpId = getParam('ctpId');
    if (!ctpId) {
        jsonResponse({ ok: false, error: 'ctpId is required' });
        return;
    }
    var migCfg    = require('*/cartridge/scripts/migration/configAccessor');
    var catalogId = getParam('catalogId')
                 || (migCfg.sfcc && migCfg.sfcc.catalogId ? String(migCfg.sfcc.catalogId) : '');
    if (!catalogId) {
        jsonResponse({ ok: false, error: 'sfcc.catalogId is not configured in config.js' });
        return;
    }
    var selectedVarAttrs = null;
    try {
        var raw = String(session.custom.selectedVariantAttrs || '');
        if (raw) { selectedVarAttrs = JSON.parse(raw); }
    } catch (pe) {}
    try {
        var prodRunner = require('*/cartridge/scripts/migration/productMigration/fullProductMigrationRunner');
        jsonResponse(prodRunner.runById(ctpId, catalogId, selectedVarAttrs));
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.MigrateProductById.public = true;

/**
 * Compare CTP product type attributes against SFCC Product attribute definitions.
 * Returns attributes present in CTP but missing in SFCC.
 * GET — no params required.
 */
exports.CheckProductAttributes = function () {
    try {
        var checker = require('*/cartridge/scripts/migration/productMigration/productAttrChecker');
        jsonResponse({ ok: true, missing: checker.checkMissingAttributes() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CheckProductAttributes.public = true;

/**
 * Create selected attribute definitions on the SFCC Product system object.
 * POST: attrs=<json-array of {id, label, sfccType}>
 */
exports.CreateProductAttributes = function () {
    var rawAttrs = getParam('attrs');
    var attrs    = [];
    try { attrs = JSON.parse(rawAttrs || '[]'); } catch (e) {
        jsonResponse({ ok: false, error: 'Invalid attrs JSON' });
        return;
    }
    if (!attrs.length) {
        jsonResponse({ ok: false, error: 'No attributes provided' });
        return;
    }
    try {
        var checker2 = require('*/cartridge/scripts/migration/productMigration/productAttrChecker');
        jsonResponse({ ok: true, result: checker2.createAttributes(attrs) });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CreateProductAttributes.public = true;

/**
 * Delete a single custom attribute definition from the SFCC Product system object.
 * POST: attrId=<attribute-id>
 */
exports.DeleteProductAttribute = function () {
    var attrId = getParam('attrId');
    if (!attrId) {
        jsonResponse({ ok: false, error: 'attrId is required' });
        return;
    }
    try {
        var sfcc2 = require('*/cartridge/scripts/migration/sfccClient');
        var tok   = sfcc2.getSFCCToken();
        sfcc2.deleteAttributeDefinition(tok, 'Product', attrId);
        jsonResponse({ ok: true });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.DeleteProductAttribute.public = true;

// ─── Category migration ───────────────────────────────────────────────────────

/**
 * Category migration page — renders the category migration UI.
 */


exports.CategoryMigrationJS = function () {
    response.setContentType('application/javascript');
    response.writer.print(getCategoryMigrationJS());
};
exports.CategoryMigrationJS.public = true;

// Paste this function into Accelerator.js
// It returns the full JS as a string served via Accelerator-CategoryMigrationJS


function getCategoryMigrationJS() {
    var L = [];

    L.push('var _APP = {};');
    L.push('_APP.allCategories = [];');
    L.push('_APP.catMap = {};');
    L.push('_APP.hierarchyOverrides = {};');
    L.push('_APP.orderOverrides = {};');
    L.push('_APP.pendingParent = {};');
    L.push('_APP.pendingOrder = {};');
    L.push('_APP.running = false;');
    L.push('_APP.draggingId = null;');
    L.push('_APP.newCatCount = 0;');
    L.push('_APP.addedCats = [];');
    L.push('_APP.activeFilter = "all";');
    L.push('_APP.MIGRATE_URL = "";');
    L.push('_APP.FETCH_URL = "";');
    L.push('_APP.ATTRS_URL = "";');
    L.push('_APP.STATUS_URL = "";');
    L.push('_APP.IMPEX_URL = "";');
    L.push('_APP.FETCH_CATALOGS_URL = "";');
    L.push('_APP.CREATE_CATALOG_URL = "";');
    L.push('_APP.CREATE_CATEGORY_URL = "";');
    L.push('_APP.IMPORT_URL = "";');

    L.push('function a(k,v){return " "+k+"="+String.fromCharCode(34)+v+String.fromCharCode(34);}');

    L.push('_APP.post = function(url,params,onDone){');
    L.push('  var req=new XMLHttpRequest();');
    L.push('  req.open("POST",url,true);');
    L.push('  req.setRequestHeader("Content-Type","application/x-www-form-urlencoded");');
    L.push('  req.onreadystatechange=function(){');
    L.push('    if(req.readyState!==4)return;');
    L.push('    var raw=req.responseText||"";');
    L.push('    var start=raw.indexOf("{");');
    L.push('    if(start>0)raw=raw.substring(start);');
    L.push('    var data;');
    L.push('    try{data=JSON.parse(raw);}catch(e){data={ok:false,error:"Parse error"};}');
    L.push('    onDone(data);');
    L.push('  };');
    L.push('  req.send(params);');
    L.push('};');

    L.push('_APP.openInNewTab=function(url){');
    L.push('  var a=document.createElement("a");');
    L.push('  a.href=url;a.target="_blank";');
    L.push('  document.body.appendChild(a);a.click();document.body.removeChild(a);');
    L.push('};');

    L.push('_APP.toCamelCase=function(str){');
    L.push('  if(!str)return"";');
    L.push('  return str.replace(/[-_]+/g," ").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/\\b\\w/g,function(c){return c.toUpperCase();});');
    L.push('};');

    L.push('_APP.getCatalogId=function(){');
    L.push('  var el=document.getElementById("cat-catalog-id");');
    L.push('  return el?el.value.trim():"";');
    L.push('};');

    L.push('_APP.goToStep=function(n){');
    L.push('  [1,2,3].forEach(function(i){');
    L.push('    var p=document.getElementById("panel-step"+i);');
    L.push('    var t=document.getElementById("tab-"+i);');
    L.push('    if(p)p.style.display=(i===n)?"block":"none";');
    L.push('    if(t){t.style.color=(i===n)?"#0070d2":"#54698d";t.style.borderBottom=(i===n)?"3px solid #0070d2":"3px solid transparent";}');
    L.push('  });');
    L.push('};');

    L.push('_APP.setPhase=function(id,state,detail,pct){');
    L.push('  var li=document.getElementById("cat-phase-"+id);');
    L.push('  var st=document.getElementById("cat-status-"+id);');
    L.push('  var det=document.getElementById("cat-detail-"+id);');
    L.push('  var bar=document.getElementById("cat-bar-"+id);');
    L.push('  if(!li)return;');
    L.push('  li.className="acc-phases__item acc-phases__item--"+state;');
    L.push('  if(st)st.textContent=state;');
    L.push('  if(det)det.textContent=detail||"";');
    L.push('  if(bar)bar.style.width=(pct||0)+"%";');
    L.push('};');

    L.push('_APP.effectiveParentId=function(catId){');
    L.push('  if(_APP.pendingParent[catId]!==undefined)return _APP.pendingParent[catId];');
    L.push('  if(_APP.hierarchyOverrides[catId]!==undefined)return _APP.hierarchyOverrides[catId];');
    L.push('  var cat=_APP.catMap[catId];');
    L.push('  return cat?(cat.parentId||"root"):"root";');
    L.push('};');

    L.push('_APP.getDepth=function(catId,visited){');
    L.push('  visited=visited||{};');
    L.push('  if(visited[catId])return 0;');
    L.push('  visited[catId]=true;');
    L.push('  var pId=_APP.effectiveParentId(catId);');
    L.push('  if(!pId||pId==="root")return 0;');
    L.push('  return _APP.catMap[pId]?1+_APP.getDepth(pId,visited):0;');
    L.push('};');

    L.push('_APP.isDescendant=function(catId,targetId){');
    L.push('  if(!targetId||targetId==="root")return false;');
    L.push('  var visited={};var cur=targetId;');
    L.push('  while(cur&&cur!=="root"){');
    L.push('    if(visited[cur])break;');
    L.push('    visited[cur]=true;');
    L.push('    if(cur===catId)return true;');
    L.push('    cur=_APP.effectiveParentId(cur);');
    L.push('  }');
    L.push('  return false;');
    L.push('};');

    L.push('_APP.getPosition=function(catId){');
    L.push('  if(_APP.pendingOrder[catId]!==undefined)return _APP.pendingOrder[catId];');
    L.push('  if(_APP.orderOverrides[catId]!==undefined)return _APP.orderOverrides[catId];');
    L.push('  var cat=_APP.catMap[catId];');
    L.push('  return cat?(cat.position||0):0;');
    L.push('};');

    L.push('_APP.getLevelColor=function(depth){');
    L.push('  var colors=["#0070d2","#5b5fc7","#2e7d32","#e65100"];');
    L.push('  return colors[depth]||"#78909c";');
    L.push('};');

    L.push('_APP.buildParentOptions=function(catId){');
    L.push('  var Q=String.fromCharCode(34);');
    L.push('  var html="<option value="+Q+"root"+Q+">root (top level)</option>";');
    L.push('  _APP.allCategories.forEach(function(c){');
    L.push('    if(c.id===catId)return;');
    L.push('    if(_APP.isDescendant(catId,c.id))return;');
    L.push('    html+="<option value="+Q+c.id+Q+">"+c.id+"</option>";');
    L.push('  });');
    L.push('  return html;');
    L.push('};');

    L.push('_APP.buildSortedRows=function(){');
    L.push('  var result=[];var visited={};');
    L.push('  function visitGroup(parentId){');
    L.push('    var children=_APP.allCategories.filter(function(c){return _APP.effectiveParentId(c.id)===parentId;});');
    L.push('    children.sort(function(a,b){return _APP.getPosition(a.id)-_APP.getPosition(b.id);});');
    L.push('    children.forEach(function(cat){');
    L.push('      if(visited[cat.id])return;');
    L.push('      visited[cat.id]=true;');
    L.push('      result.push({id:cat.id,name:cat.name,parentId:_APP.effectiveParentId(cat.id),depth:_APP.getDepth(cat.id),position:_APP.getPosition(cat.id)});');
    L.push('      visitGroup(cat.id);');
    L.push('    });');
    L.push('  }');
    L.push('  visitGroup("root");');
    L.push('  _APP.allCategories.forEach(function(cat){if(!visited[cat.id])result.push({id:cat.id,name:cat.name,parentId:_APP.effectiveParentId(cat.id),depth:_APP.getDepth(cat.id),position:_APP.getPosition(cat.id)});});');
    L.push('  return result;');
    L.push('};');

    L.push('_APP.applyDrop=function(srcId,tgtId,tgtParent,dropTop){');
    L.push('  if(dropTop){');
    L.push('    if(tgtParent!=="root"&&_APP.isDescendant(srcId,tgtParent)){alert("Cannot move: circular reference.");return false;}');
    L.push('    _APP.pendingParent[srcId]=tgtParent;');
    L.push('    var siblings=_APP.allCategories.filter(function(c){return c.id!==srcId&&_APP.effectiveParentId(c.id)===tgtParent;}).sort(function(a,b){return _APP.getPosition(a.id)-_APP.getPosition(b.id);});');
    L.push('    var tgtPos=siblings.length;');
    L.push('    for(var i=0;i<siblings.length;i++){if(siblings[i].id===tgtId){tgtPos=i;break;}}');
    L.push('    siblings.splice(tgtPos,0,_APP.catMap[srcId]);');
    L.push('    siblings.forEach(function(s,idx){_APP.pendingOrder[s.id]=idx+1;});');
    L.push('  }else{');
    L.push('    if(tgtId===srcId||_APP.isDescendant(srcId,tgtId)){alert("Cannot move: circular reference.");return false;}');
    L.push('    _APP.pendingParent[srcId]=tgtId;');
    L.push('    var ec=_APP.allCategories.filter(function(c){return c.id!==srcId&&_APP.effectiveParentId(c.id)===tgtId;}).sort(function(a,b){return _APP.getPosition(a.id)-_APP.getPosition(b.id);});');
    L.push('    ec.forEach(function(c,idx){_APP.pendingOrder[c.id]=idx+1;});');
    L.push('    _APP.pendingOrder[srcId]=ec.length+1;');
    L.push('  }');
    L.push('  return true;');
    L.push('};');

    L.push('_APP.buildLevelFilterTabs=function(){');
    L.push('  var tabsEl=document.getElementById("level-filter-tabs");');
    L.push('  if(!tabsEl)return;');
    L.push('  var depths={};');
    L.push('  _APP.allCategories.forEach(function(c){var d=_APP.getDepth(c.id);depths[d]=(depths[d]||0)+1;});');
    L.push('  var levels=Object.keys(depths).map(Number).sort(function(a,b){return a-b;});');
    L.push('  var colors=["#0070d2","#5b5fc7","#2e7d32","#e65100","#78909c"];');
    L.push('  var Q=String.fromCharCode(34);');
    L.push('  var abg=_APP.activeFilter==="all"?"background:#0070d2;color:#fff;":"background:#fff;color:#0070d2;";');
    L.push('  var html="<button type="+Q+"button"+Q+" data-level="+Q+"all"+Q+" style="+Q+"padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:2px solid #0070d2;"+abg+Q+">All ("+_APP.allCategories.length+")</button>";');
    L.push('  levels.forEach(function(lvl){');
    L.push('    var color=colors[lvl]||"#78909c";');
    L.push('    var isActive=_APP.activeFilter===String(lvl);');
    L.push('    var lbg=isActive?"background:"+color+";color:#fff;":"background:#fff;color:"+color+";";');
    L.push('    html+="<button type="+Q+"button"+Q+" data-level="+Q+lvl+Q+" style="+Q+"padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:2px solid "+color+";"+lbg+Q+">L"+(lvl+1)+" ("+depths[lvl]+")</button>";');
    L.push('  });');
    L.push('  tabsEl.innerHTML=html;');
    L.push('  tabsEl.style.display="flex";');
    L.push('  var btns=tabsEl.querySelectorAll("button");');
    L.push('  for(var i=0;i<btns.length;i++){btns[i].addEventListener("click",function(){_APP.activeFilter=this.getAttribute("data-level");_APP.buildLevelFilterTabs();_APP.applyLevelFilter();});}');
    L.push('};');

    L.push('_APP.applyLevelFilter=function(){');
    L.push('  var rows=document.querySelectorAll("#main-cat-tbody tr[data-catid]");');
    L.push('  for(var i=0;i<rows.length;i++){rows[i].style.display=(_APP.activeFilter==="all"||rows[i].getAttribute("data-depth")===_APP.activeFilter)?"":"none";}');
    L.push('};');

    L.push('_APP.updatePendingSummary=function(){');
    L.push('  var allIds={};');
    L.push('  Object.keys(_APP.pendingParent).forEach(function(k){allIds[k]=true;});');
    L.push('  Object.keys(_APP.pendingOrder).forEach(function(k){allIds[k]=true;});');
    L.push('  var total=Object.keys(allIds).length;');
    L.push('  var s=document.getElementById("hierarchy-changes-summary");');
    L.push('  var b=document.getElementById("btn-save-hierarchy");');
    L.push('  var c=document.getElementById("hierarchy-changes-count");');
    L.push('  if(total>0){if(s)s.style.display="block";if(c)c.textContent=total;}');
    L.push('  else{if(s)s.style.display="none";}');
    L.push('};');

    L.push('_APP.renderTable=function(){');
    L.push('  var tbody=document.getElementById("main-cat-tbody");');
    L.push('  if(!tbody)return;');
    L.push('  tbody.innerHTML="";');
    L.push('  var Q=String.fromCharCode(34);');
    L.push('  if(!_APP.allCategories.length){tbody.innerHTML="<tr><td colspan="+Q+"6"+Q+" style="+Q+"text-align:center;padding:30px;color:#54698d;"+Q+">Click Load Categories from CT to begin.</td></tr>";return;}');
    L.push('  var sorted=_APP.buildSortedRows();');
    L.push('  sorted.forEach(function(row,idx){');
    L.push('    var catId=row.id;');
    L.push('    var isPC=_APP.pendingParent[catId]!==undefined||_APP.hierarchyOverrides[catId]!==undefined;');
    L.push('    var isOC=_APP.pendingOrder[catId]!==undefined||_APP.orderOverrides[catId]!==undefined;');
    L.push('    var isChanged=isPC||isOC;');
    L.push('    var currentParent=row.parentId;');
    L.push('    var lvlColor=_APP.getLevelColor(row.depth);');
    L.push('    var lvlLabel="L"+(row.depth+1);');
    L.push('    var origParent=_APP.catMap[catId]?(_APP.catMap[catId].parentId||"root"):"root";');
    L.push('    var parentOpts=_APP.buildParentOptions(catId).replace("value="+Q+currentParent+Q,"value="+Q+currentParent+Q+" selected");');
    L.push('    var sb=isPC?"#0070d2":"#dddbda";');
    L.push('    var sbg=isPC?"#e8f4fd":"#fff";');
    L.push('    var pb=isOC?"background:#fff3e0;border-color:#ffb300;color:#e65100;":"";');
    L.push('    var rb=isChanged?"background:#fff8e1;":"";');
    L.push('    var tdSt="padding:7px 8px;border-bottom:1px solid #f0f0f0;";');
    L.push('    var trHtml="<tr"');
    L.push('      +" data-catid="+Q+catId+Q');
    L.push('      +" data-depth="+Q+row.depth+Q');
    L.push('      +" data-parent="+Q+currentParent+Q');
    L.push('      +" data-changed="+Q+(isChanged?"1":"0")+Q');
    L.push('      +" style="+Q+rb+Q+">";');
    L.push('    trHtml+="<td"+a("style",tdSt+"text-align:center;")+"><span class="+Q+"drag-handle-icon"+Q+a("data-catid",catId)+a("style","cursor:grab;color:#a8b7c7;font-size:20px;user-select:none;")+">&#8597;</span></td>";');
    L.push('    trHtml+="<td"+a("style",tdSt)+"><span"+a("style","display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;color:#fff;background:"+lvlColor+";")+">"+lvlLabel+"</span></td>";');
    L.push('    trHtml+="<td"+a("style",tdSt)+"><span id="+Q+"pos-"+catId+Q+a("style","display:inline-block;background:#f4f6f9;border:1px solid #dddbda;border-radius:3px;padding:1px 6px;font-size:11px;font-family:monospace;"+pb)+">"+(idx+1)+"</span></td>";');
    L.push('    trHtml+="<td"+a("style",tdSt+"font-family:monospace;font-size:11px;")+">"+catId+"</td>";');
    L.push('    trHtml+="<td"+a("style",tdSt+"font-weight:600;color:#16325c;")+">"+_APP.toCamelCase(row.name)+"</td>";');
    L.push('    trHtml+="<td"+a("style",tdSt)+"><select"+a("data-catid",catId)+a("data-orig",origParent)+a("style","width:100%;font-size:12px;padding:4px 6px;border:1px solid "+sb+";border-radius:3px;background:"+sbg+";")+">"+parentOpts+"</select></td>";');
    L.push('    trHtml+="</tr>";');
    L.push('    tbody.innerHTML+=trHtml;');
    L.push('  });');
    L.push('  var selects=tbody.querySelectorAll("select");');
    L.push('  for(var i=0;i<selects.length;i++){selects[i].addEventListener("change",_APP.onParentDropdownChange);}');
    L.push('  _APP.initDragDrop(tbody);');
    L.push('  _APP.buildLevelFilterTabs();');
    L.push('  _APP.applyLevelFilter();');
    L.push('  _APP.updatePendingSummary();');
    L.push('};');

    L.push('_APP.onParentDropdownChange=function(evt){');
    L.push('  var select=evt.target;');
    L.push('  var catId=select.getAttribute("data-catid");');
    L.push('  var orig=select.getAttribute("data-orig");');
    L.push('  var newVal=select.value;');
    L.push('  if(newVal===catId){alert("A category cannot be its own parent.");select.value=_APP.effectiveParentId(catId);return;}');
    L.push('  if(newVal!=="root"&&_APP.isDescendant(catId,newVal)){alert("Cannot set: circular reference.");select.value=_APP.effectiveParentId(catId);return;}');
    L.push('  if(newVal===orig){delete _APP.pendingParent[catId];}else{');
    L.push('    _APP.pendingParent[catId]=newVal;');
    L.push('    var sib=_APP.allCategories.filter(function(c){return c.id!==catId&&_APP.effectiveParentId(c.id)===newVal;}).sort(function(a,b){return _APP.getPosition(a.id)-_APP.getPosition(b.id);});');
    L.push('    _APP.pendingOrder[catId]=sib.length+1;');
    L.push('  }');
    L.push('  _APP.updatePendingSummary();');
    L.push('  _APP.renderTable();');
    L.push('};');

    L.push('_APP.initDragDrop=function(tbody){');
    L.push('  var dragRow=null;var dragId=null;');
    L.push('  function getRow(el){while(el&&el.tagName!=="TR")el=el.parentNode;return(el&&el.getAttribute("data-catid"))?el:null;}');
    L.push('  function getAllRows(){return Array.prototype.slice.call(tbody.querySelectorAll("tr[data-catid]"));}');
    L.push('  function removePH(){var p=document.getElementById("drag-placeholder");if(p&&p.parentNode)p.parentNode.removeChild(p);}');
    L.push('  function makePH(h){var p=document.createElement("tr");p.id="drag-placeholder";p.style.cssText="height:"+(h||36)+"px;background:#e8f4fd;pointer-events:none;";return p;}');
    L.push('  function getRowAtY(y){');
    L.push('    var rows=getAllRows();');
    L.push('    for(var i=0;i<rows.length;i++){if(rows[i].style.display==="none")continue;var r=rows[i].getBoundingClientRect();if(y>=r.top&&y<=r.bottom)return{row:rows[i],top:y<r.top+r.height/2};}');
    L.push('    var last=null;for(var j=rows.length-1;j>=0;j--){if(rows[j].style.display!=="none"){last=rows[j];break;}}');
    L.push('    if(last){var lr=last.getBoundingClientRect();if(y>lr.bottom)return{row:last,top:false};}');
    L.push('    return null;');
    L.push('  }');
    L.push('  function onMM(e){');
    L.push('    if(!dragRow)return;e.preventDefault();');
    L.push('    var rz=document.getElementById("root-drop-zone");');
    L.push('    if(rz){var rr=rz.getBoundingClientRect();if(e.clientY>=rr.top&&e.clientY<=rr.bottom&&e.clientX>=rr.left&&e.clientX<=rr.right){rz.style.background="#cce4f7";rz.style.borderColor="#0050a0";removePH();return;}else{rz.style.background="#f0f7ff";rz.style.borderColor="#0070d2";}}');
    L.push('    var hit=getRowAtY(e.clientY);if(!hit||hit.row===dragRow)return;');
    L.push('    removePH();var ph=makePH(dragRow.getBoundingClientRect().height);');
    L.push('    if(hit.top){ph.style.borderTop="3px solid #0070d2";hit.row.parentNode.insertBefore(ph,hit.row);}');
    L.push('    else{ph.style.borderBottom="3px solid #5b5fc7";var ns=hit.row.nextSibling;if(ns)hit.row.parentNode.insertBefore(ph,ns);else hit.row.parentNode.appendChild(ph);}');
    L.push('  }');
    L.push('  function onMU(e){');
    L.push('    document.removeEventListener("mousemove",onMM);document.removeEventListener("mouseup",onMU);');
    L.push('    if(!dragRow)return;');
    L.push('    dragRow.style.opacity="";dragRow.style.background=dragRow.getAttribute("data-changed")==="1"?"#fff8e1":"";');
    L.push('    var rz=document.getElementById("root-drop-zone");');
    L.push('    if(rz){var rr=rz.getBoundingClientRect();if(e.clientY>=rr.top&&e.clientY<=rr.bottom&&e.clientX>=rr.left&&e.clientX<=rr.right){removePH();rz.style.display="none";_APP.pendingParent[dragId]="root";var rc=_APP.allCategories.filter(function(c){return c.id!==dragId&&_APP.effectiveParentId(c.id)==="root";}).sort(function(a,b){return _APP.getPosition(a.id)-_APP.getPosition(b.id);});rc.forEach(function(c,idx){_APP.pendingOrder[c.id]=idx+1;});_APP.pendingOrder[dragId]=rc.length+1;dragRow=null;dragId=null;_APP.draggingId=null;_APP.updatePendingSummary();_APP.renderTable();return;}rz.style.display="none";}');
    L.push('    var p=document.getElementById("drag-placeholder");if(!p){dragRow=null;dragId=null;_APP.draggingId=null;return;}');
    L.push('    var isTop=p.style.borderTop!=="";var tgt=null;');
    L.push('    if(isTop){var nx=p.nextSibling;while(nx&&(!nx.getAttribute||!nx.getAttribute("data-catid")))nx=nx.nextSibling;if(nx&&nx.getAttribute("data-catid"))tgt=nx;}');
    L.push('    else{var pv=p.previousSibling;while(pv&&(!pv.getAttribute||!pv.getAttribute("data-catid")))pv=pv.previousSibling;if(pv&&pv.getAttribute("data-catid"))tgt=pv;}');
    L.push('    removePH();');
    L.push('    if(!tgt||tgt===dragRow){dragRow=null;dragId=null;_APP.draggingId=null;return;}');
    L.push('    var ok=_APP.applyDrop(dragId,tgt.getAttribute("data-catid"),tgt.getAttribute("data-parent"),isTop);');
    L.push('    dragRow=null;dragId=null;_APP.draggingId=null;');
    L.push('    if(ok){_APP.updatePendingSummary();_APP.renderTable();}');
    L.push('  }');
    L.push('  var handles=tbody.querySelectorAll(".drag-handle-icon");');
    L.push('  for(var h=0;h<handles.length;h++){');
    L.push('    handles[h].addEventListener("mousedown",function(e){');
    L.push('      e.preventDefault();var row=getRow(e.target);if(!row)return;');
    L.push('      dragRow=row;dragId=row.getAttribute("data-catid");_APP.draggingId=dragId;');
    L.push('      dragRow.style.opacity="0.5";dragRow.style.background="#e8f4fd";');
    L.push('      var rz=document.getElementById("root-drop-zone");if(rz)rz.style.display="block";');
    L.push('      document.addEventListener("mousemove",onMM);document.addEventListener("mouseup",onMU);');
    L.push('    });');
    L.push('  }');
    L.push('};');

    L.push('_APP.finalize=function(success,message){');
    L.push('  _APP.running=false;');
    L.push('  var btn=document.getElementById("cat-start-btn");');
    L.push('  if(btn){btn.disabled=false;btn.textContent=success?"Migration Complete":"Migration Failed";}');
    L.push('  var box=document.getElementById("cat-move-status");');
    L.push('  if(box){box.style.display="block";box.style.padding="12px 16px";box.style.borderRadius="4px";box.style.fontSize="13px";box.style.background=success?"#e8f5e9":"#fff3e0";box.style.border=success?"1px solid #2e7d32":"1px solid #ffb300";box.style.color=success?"#2e7d32":"#e65100";box.textContent=message;}');
    L.push('};');


    L.push('_APP.populateParentDropdown=function(){');
    L.push('  var sel=document.getElementById("ct-new-cat-parent");');
    L.push('  if(!sel)return;');
    L.push('  var cur=sel.value;');
    L.push('  sel.innerHTML="<option value=\\"\\">-- Root (no parent) --</option>";');
    L.push('  var cats=_APP.allCategories||[];');
    L.push('  for(var i=0;i<cats.length;i++){');
    L.push('    var opt=document.createElement("option");');
    L.push('    opt.value=cats[i].id;');
    L.push('    opt.textContent=cats[i].name+" ("+cats[i].id+")";');
    L.push('    sel.appendChild(opt);');
    L.push('  }');
    L.push('  sel.value=cur;');
    L.push('};');


    // ── _APP.init ─────────────────────────────────────────────────────────────
    L.push('_APP.init=function(){');
    L.push('  var el;');

    // Load Catalogs
    L.push('  el=document.getElementById("btn-load-catalogs");');
    L.push('  if(el)el.addEventListener("click",function(){');
    L.push('    var btn=this;var status=document.getElementById("catalog-load-status");var sel=document.getElementById("cat-catalog-select");');
    L.push('    btn.disabled=true;btn.textContent="Loading...";');
    L.push('    if(status){status.textContent="Fetching catalogs...";status.style.color="#54698d";}');
    L.push('    _APP.post(_APP.FETCH_CATALOGS_URL,"",function(data){');
    L.push('      btn.disabled=false;btn.textContent="Load Catalogs";');
    L.push('      if(!data.ok){if(status){status.textContent="Error: "+(data.error||"failed");status.style.color="#c62828";}return;}');
    L.push('      var Q=String.fromCharCode(34);');
    L.push('      if(sel){sel.innerHTML="<option value="+Q+Q+">-- Select a catalog --</option>";(data.catalogs||[]).forEach(function(c){sel.innerHTML+="<option value="+Q+c.id+Q+">"+(c.name||c.id)+" ("+c.id+")</option>";});}');
    L.push('      if(status){status.textContent=(data.total||(data.catalogs||[]).length)+" catalogs loaded";status.style.color="#2e7d32";}');
    L.push('    });');
    L.push('  });');

    L.push('  el=document.getElementById("cat-catalog-select");');
    L.push('  if(el)el.addEventListener("change",function(){var cid=document.getElementById("cat-catalog-id");if(cid&&this.value)cid.value=this.value;});');

    // Step 1 - Check Attributes (checkbox-based)
    L.push('  el=document.getElementById("btn-check-attrs");');
    L.push('  if(el)el.addEventListener("click",function(){');
    L.push('    var btn=this;btn.disabled=true;btn.textContent="Checking...";');
    L.push('    _APP.post(_APP.ATTRS_URL,"",function(data){');
    L.push('      btn.disabled=false;btn.textContent="Check Attributes";');
    L.push('      var Q=String.fromCharCode(34);');
    L.push('      var tbody=document.getElementById("attr-tbody");');
    L.push('      if(tbody){');
    L.push('        tbody.innerHTML="";');
    L.push('        var attrs=data.attrs||[];');
  L.push('        attrs.forEach(function(attr){');
    L.push('          var statusColor=attr.exists?"#2e7d32":"#e65100";');
    L.push('          var statusBg=attr.exists?"#e8f5e9":"#fff3e0";');
    L.push('          var statusText=attr.exists?"Exists":"Missing";');
    L.push('          var chk=!attr.exists?"checked":"";');
    L.push('          var tdSt="padding:8px 12px;border:1px solid #dddbda;";');
    L.push('          tbody.innerHTML+="<tr>"');
    L.push('            +"<td"+a("style",tdSt+"text-align:center;width:52px;")+">"');
    L.push('            +"<input type="+Q+"checkbox"+Q+" data-attrid="+Q+attr.id+Q+" data-attrtype="+Q+attr.sfccType+Q+" data-attrlabel="+Q+attr.label+Q+" "+chk+a("style","width:16px;height:16px;cursor:pointer;")+"/>"');
    L.push('            +"</td>"');
    L.push('            +"<td"+a("style",tdSt)+"><code>"+attr.id+"</code></td>"');
    L.push('            +"<td"+a("style",tdSt)+">"+attr.sfccType+"</td>"');
    L.push('            +"<td"+a("style",tdSt)+">"+attr.label+"</td>"');
    L.push('            +"<td"+a("style",tdSt)+"><span"+a("style","background:"+statusBg+";color:"+statusColor+";padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;")+">"+statusText+"</span></td>"');
    L.push('            +"</tr>";');
    L.push('        });');
    L.push('      }');
    L.push('      var ar=document.getElementById("attr-result");if(ar)ar.style.display="block";');
    L.push('      var ao=document.getElementById("attr-overall");if(ao){ao.textContent="Select attributes to create then click Create Selected.";ao.style.color="#54698d";}');
    L.push('      var cb=document.getElementById("btn-create-selected-attrs");if(cb)cb.style.display="inline-block";');
    L.push('    });');
    L.push('  });');

    // Select All
    L.push('  el=document.getElementById("btn-select-all-attrs");');
    L.push('  if(el)el.addEventListener("click",function(){');
    L.push('    var boxes=document.querySelectorAll("#attr-tbody input[type=checkbox]");');
    L.push('    for(var i=0;i<boxes.length;i++)boxes[i].checked=true;');
    L.push('  });');

    // Deselect All
    L.push('  el=document.getElementById("btn-deselect-all-attrs");');
    L.push('  if(el)el.addEventListener("click",function(){');
    L.push('    var boxes=document.querySelectorAll("#attr-tbody input[type=checkbox]");');
    L.push('    for(var i=0;i<boxes.length;i++)boxes[i].checked=false;');
    L.push('  });');

    // Revert to Default (missing = checked, existing = unchecked)
   L.push('  el=document.getElementById("btn-revert-attrs");');
    L.push('  if(el)el.addEventListener("click",function(){');
    L.push('    var boxes=document.querySelectorAll("#attr-tbody input[type=checkbox]:checked");');
    L.push('    if(!boxes.length){alert("No attributes selected to delete.");return;}');
    L.push('    var toDelete=[];');
    L.push('    for(var i=0;i<boxes.length;i++){toDelete.push(boxes[i].getAttribute("data-attrid"));}');
    L.push('    if(!confirm("Delete "+toDelete.length+" attribute(s) from SFCC Category system object? This cannot be undone.\\n\\n"+toDelete.join(", ")))return;');
    L.push('    var ao=document.getElementById("attr-overall");');
    L.push('    if(ao){ao.textContent="Deleting "+toDelete.length+" attribute(s)...";ao.style.color="#54698d";}');
    L.push('    _APP.post(_APP.ATTRS_URL,"delete="+encodeURIComponent(JSON.stringify(toDelete)),function(data){');
    L.push('      if(!data.ok){if(ao){ao.textContent="Error: "+(data.error||"failed");ao.style.color="#c62828";}return;}');
    L.push('      if(ao){ao.textContent="Deleted: "+data.deleted+" | Failed: "+data.failed;ao.style.color=data.failed>0?"#e65100":"#2e7d32";}');
    L.push('      _APP.post(_APP.ATTRS_URL,"",function(refreshData){');
    L.push('        if(!refreshData.ok||!refreshData.attrs)return;');
    L.push('        var tbody2=document.getElementById("attr-tbody");');
    L.push('        if(!tbody2)return;');
    L.push('        var rows=tbody2.querySelectorAll("tr");');
    L.push('        refreshData.attrs.forEach(function(attr,idx){');
    L.push('          if(!rows[idx])return;');
    L.push('          var statusCell=rows[idx].querySelector("span");');
    L.push('          var checkbox=rows[idx].querySelector("input[type=checkbox]");');
    L.push('          if(statusCell){');
    L.push('            statusCell.textContent=attr.exists?"Exists":"Missing";');
    L.push('            statusCell.style.background=attr.exists?"#e8f5e9":"#fff3e0";');
    L.push('            statusCell.style.color=attr.exists?"#2e7d32":"#e65100";');
    L.push('          }');
    L.push('          if(checkbox){checkbox.checked=!attr.exists;}');
    L.push('        });');
    L.push('      });');
    L.push('    });');
    L.push('  });');

    // Create Selected
    L.push('  el=document.getElementById("btn-create-selected-attrs");');
    L.push('  if(el)el.addEventListener("click",function(){');
    L.push('    var boxes=document.querySelectorAll("#attr-tbody input[type=checkbox]:checked");');
    L.push('    if(!boxes.length){alert("No attributes selected. Check at least one attribute to create.");return;}');
    L.push('    var selected=[];');
    L.push('    for(var i=0;i<boxes.length;i++){');
    L.push('      selected.push({id:boxes[i].getAttribute("data-attrid"),sfccType:boxes[i].getAttribute("data-attrtype"),label:boxes[i].getAttribute("data-attrlabel")});');
    L.push('    }');
    L.push('    var btn=this;btn.disabled=true;btn.textContent="Creating...";');
    L.push('    var ao=document.getElementById("attr-overall");');
    L.push('    if(ao){ao.textContent="Creating "+selected.length+" attribute(s)...";ao.style.color="#54698d";}');
    L.push('    _APP.post(_APP.ATTRS_URL,"selected="+encodeURIComponent(JSON.stringify(selected)),function(data){');
    L.push('      btn.disabled=false;btn.textContent="Create Selected";');
    L.push('      if(!data.ok&&data.error){if(ao){ao.textContent="Error: "+data.error;ao.style.color="#c62828";}return;}');
L.push('      var msg="Done - "+data.created+" created, "+data.skipped+" skipped, "+data.failed+" failed.";');
    L.push('      if(ao){ao.textContent=msg;ao.style.color=data.failed>0?"#e65100":"#2e7d32";}');
    L.push('      if(data.errors&&data.errors.length){var eb=document.getElementById("attr-errors");if(eb){eb.style.display="block";eb.textContent="Errors: "+data.errors.join(", ");}}');
    L.push('      _APP.post(_APP.ATTRS_URL,"",function(refreshData){');
    L.push('        if(!refreshData.ok||!refreshData.attrs)return;');
    L.push('        var Q=String.fromCharCode(34);');
    L.push('        var tbody2=document.getElementById("attr-tbody");');
    L.push('        if(!tbody2)return;');
    L.push('        var rows=tbody2.querySelectorAll("tr");');
    L.push('        refreshData.attrs.forEach(function(attr,idx){');
    L.push('          if(!rows[idx])return;');
    L.push('          var statusCell=rows[idx].querySelector("span");');
    L.push('          var checkbox=rows[idx].querySelector("input[type=checkbox]");');
    L.push('          if(statusCell){');
    L.push('            statusCell.textContent=attr.exists?"Exists":"Missing";');
    L.push('            statusCell.style.background=attr.exists?"#e8f5e9":"#fff3e0";');
    L.push('            statusCell.style.color=attr.exists?"#2e7d32":"#e65100";');
    L.push('          }');
    L.push('          if(checkbox){checkbox.checked=!attr.exists;}');
    L.push('        });');
    L.push('      });');
    L.push('      if(data.failed===0){setTimeout(function(){_APP.goToStep(2);},2000);}');
    L.push('    });');
    L.push('  });');

    L.push('  el=document.getElementById("btn-skip-attrs");if(el)el.addEventListener("click",function(){_APP.goToStep(2);});');

    // Step 2
    L.push('  el=document.getElementById("btn-save-hierarchy");');
    L.push('  if(el)el.addEventListener("click",function(){');
    L.push('    Object.keys(_APP.pendingParent).forEach(function(k){_APP.hierarchyOverrides[k]=_APP.pendingParent[k];});');
    L.push('    Object.keys(_APP.pendingOrder).forEach(function(k){_APP.orderOverrides[k]=_APP.pendingOrder[k];});');
    L.push('    _APP.pendingParent={};_APP.pendingOrder={};');
    L.push('    _APP.renderTable();');
    L.push('    var total=Object.keys(_APP.hierarchyOverrides).length+Object.keys(_APP.orderOverrides).length;');
    L.push('    var applied=document.getElementById("hierarchy-applied-summary");var appCnt=document.getElementById("hierarchy-applied-count");');
    L.push('    if(appCnt)appCnt.textContent=total;');
    L.push('    if(applied)applied.style.display="block";');
    L.push('    document.getElementById("hierarchy-changes-summary").style.display="none";');
    L.push('  });');

    L.push('  el=document.getElementById("btn-reset-hierarchy");');
    L.push('  if(el)el.addEventListener("click",function(){');
    L.push('    _APP.hierarchyOverrides={};_APP.orderOverrides={};_APP.pendingParent={};_APP.pendingOrder={};_APP.activeFilter="all";');
    L.push('    var applied=document.getElementById("hierarchy-applied-summary");');
    L.push('    var summary=document.getElementById("hierarchy-changes-summary");');
    L.push('    var saveBtn=document.getElementById("btn-save-hierarchy");');
    L.push('    if(applied)applied.style.display="none";');
    L.push('    if(summary)summary.style.display="none";');
    L.push('    _APP.renderTable();');
    L.push('  });');

    L.push('  el=document.getElementById("hierarchy-search");');
    L.push('  if(el)el.addEventListener("input",function(){');
    L.push('    var query=this.value.toLowerCase();');
    L.push('    var rows=document.querySelectorAll("#main-cat-tbody tr[data-catid]");');
    L.push('    for(var i=0;i<rows.length;i++){var ms=!query||rows[i].textContent.toLowerCase().indexOf(query)>-1;var ml=_APP.activeFilter==="all"||rows[i].getAttribute("data-depth")===_APP.activeFilter;rows[i].style.display=(ms&&ml)?"":"none";}');
    L.push('  });');

    L.push('  el=document.getElementById("btn-load-categories");');
    L.push('  if(el)el.addEventListener("click",function(){');
    L.push('    var btn=this;var status=document.getElementById("hierarchy-fetch-status");');
    L.push('    var locale=document.getElementById("cat-locale")?document.getElementById("cat-locale").value.trim():"en-US";');
    L.push('    btn.disabled=true;btn.textContent="Loading...";');
    L.push('    if(status){status.textContent="Fetching from Commercetools...";status.style.color="#54698d";}');
    L.push('    _APP.post(_APP.FETCH_URL,"locale="+encodeURIComponent(locale||"en-US"),function(data){');
    L.push('      btn.disabled=false;btn.textContent="Load Categories from CT";');
    L.push('      if(!data.ok){if(status){status.textContent="Error: "+(data.error||"failed");status.style.color="#c62828";}return;}');
    L.push('      _APP.allCategories=data.categories;_APP.catMap={};');
    L.push('      _APP.hierarchyOverrides={};_APP.orderOverrides={};_APP.pendingParent={};_APP.pendingOrder={};_APP.activeFilter="all";_APP.newCatCount=0;_APP.addedCats=[];');
    L.push('      _APP.allCategories.forEach(function(c){_APP.catMap[c.id]=c;});');
    L.push('      _APP.populateParentDropdown();');
    L.push('      if(status){status.textContent=data.total+" categories loaded";status.style.color="#2e7d32";}');
    L.push('      var applied=document.getElementById("hierarchy-applied-summary");if(applied)applied.style.display="none";');
    L.push('      _APP.renderTable();');
    L.push('    });');
    L.push('  });');

    L.push('  el=document.getElementById("btn-create-ct-category");');
    L.push('  if(el)el.addEventListener("click",function(){');
    L.push('    var key=document.getElementById("ct-new-cat-key").value.trim();');
    L.push('    var name=document.getElementById("ct-new-cat-name").value.trim();');
    L.push('    var parentId=document.getElementById("ct-new-cat-parent").value.trim();');
    L.push('    var status=document.getElementById("ct-new-cat-status");');
    L.push('    if(!key||!name){if(status){status.textContent="Key and Name are required.";status.style.color="#c62828";}return;}');
    L.push('    if(_APP.catMap&&_APP.catMap[key]){if(status){status.textContent="A category with this key already exists.";status.style.color="#c62828";}return;}');
    L.push('    if(!_APP.allCategories)_APP.allCategories=[];');
    L.push('    if(!_APP.catMap)_APP.catMap={};');
    L.push('    var newCat={id:key,name:name,parentId:parentId||""};');
    L.push('    _APP.allCategories.push(newCat);');
    L.push('    _APP.catMap[key]=newCat;');
    L.push('    _APP.addedCats.push(newCat);');
    L.push('    _APP.newCatCount++;');
    L.push('    _APP.renderTable();');
    L.push('    _APP.populateParentDropdown();');
    L.push('    if(status){status.textContent="Added: "+key;status.style.color="#2e7d32";}');
    L.push('    document.getElementById("ct-new-cat-key").value="";');
    L.push('    document.getElementById("ct-new-cat-name").value="";');
    L.push('    document.getElementById("ct-new-cat-parent").value="";');
    L.push('  });');

    L.push('  el=document.getElementById("btn-back-to-step1");if(el)el.addEventListener("click",function(){_APP.goToStep(1);});');
    L.push('  el=document.getElementById("btn-back-to-step2");if(el)el.addEventListener("click",function(){_APP.goToStep(2);});');

    L.push('  el=document.getElementById("btn-next-to-step3");');
    L.push('  if(el)el.addEventListener("click",function(){');
    L.push('    var pc=Object.keys(_APP.pendingParent).length+Object.keys(_APP.pendingOrder).length;');
    L.push('    if(pc>0&&!confirm(pc+" unsaved change(s) will be discarded. Proceed?"))return;');
    L.push('    _APP.pendingParent={};_APP.pendingOrder={};');
    L.push('    var s=document.getElementById("step3-summary");');
    L.push('    var newCatPart=_APP.newCatCount>0?" | New categories: "+_APP.newCatCount:"";');
    L.push('    if(s)s.textContent="Step 3 of 3 - Export. Categories: "+_APP.allCategories.length+" | Parent changes: "+Object.keys(_APP.hierarchyOverrides).length+" | Order changes: "+Object.keys(_APP.orderOverrides).length+newCatPart+" | Catalog: "+(_APP.getCatalogId()||"not set");');
    L.push('    _APP.goToStep(3);');
    L.push('  });');

    // Step 3
    L.push('  el=document.getElementById("btn-open-impex");if(el)el.addEventListener("click",function(e){e.preventDefault();_APP.openInNewTab(_APP.IMPEX_URL);});');
    L.push('  el=document.getElementById("btn-open-import");if(el)el.addEventListener("click",function(e){e.preventDefault();_APP.openInNewTab(_APP.IMPORT_URL);});');

    L.push('  el=document.getElementById("cat-start-btn");');
    L.push('  if(el)el.addEventListener("click",function(){');
    L.push('    if(_APP.running)return;');
    L.push('    var catalogId=_APP.getCatalogId();');
    L.push('    var locale=document.getElementById("cat-locale")?document.getElementById("cat-locale").value.trim():"en-US";');
    L.push('    if(!catalogId){alert("Please select or enter a Target Catalog ID.");return;}');
    L.push('    if(!locale){alert("Please enter a Default Locale.");return;}');
    L.push('    _APP.running=true;this.disabled=true;this.textContent="Running...";');
    L.push('    var cs=document.getElementById("cat-move-status");if(cs)cs.style.display="none";');
    L.push('    var pl=document.getElementById("cat-phase-list");if(pl)pl.style.display="block";');
    L.push('    var xc=document.getElementById("cat-xml-controls");if(xc)xc.style.display="none";');
    L.push('    _APP.setPhase("fetch","active","Fetching and transforming categories...",10);');
    L.push('    _APP.setPhase("import","pending","Waiting for Phase 1...",0);');
    L.push('    var fo={};');
    L.push('    Object.keys(_APP.hierarchyOverrides).forEach(function(k){fo[k]={parent:_APP.hierarchyOverrides[k]};});');
    L.push('    Object.keys(_APP.orderOverrides).forEach(function(k){if(!fo[k])fo[k]={};fo[k].position=_APP.orderOverrides[k];});');
    L.push('    var extra=(_APP.addedCats&&_APP.addedCats.length)?encodeURIComponent(JSON.stringify(_APP.addedCats)):"";');
    L.push('    _APP.post(_APP.MIGRATE_URL,"catalogId="+encodeURIComponent(catalogId)+"&locale="+encodeURIComponent(locale)+"&mode=xml&overrides="+encodeURIComponent(JSON.stringify(fo))+"&extraCategories="+extra,function(data){');
    L.push('      if(!data.ok){_APP.setPhase("fetch","error",data.error||"Failed",0);_APP.finalize(false,data.error||"Migration failed.");return;}');
    L.push('      _APP.setPhase("fetch","done",data.total+" categories fetched and transformed",100);');
    L.push('      _APP.setPhase("import","active","Writing XML to IMPEX...",50);');
    L.push('      var xp=document.getElementById("cat-xml-path");if(xp)xp.textContent=data.xmlPath||"";');
    L.push('      if(xc)xc.style.display="block";');
    L.push('      _APP.setPhase("import","done","XML written - click buttons below to open IMPEX",100);');
    L.push('      _APP.finalize(true,data.total+" categories exported to IMPEX XML. Use the buttons above to complete the import in BM.");');
    L.push('    });');
    L.push('  });');

    // Generate catalog XML via IMPEX
    L.push('  el=document.getElementById("btn-create-catalog");');
    L.push('  if(el)el.addEventListener("click",function(){');
    L.push('    var btn=this;');
    L.push('    var catId=document.getElementById("new-catalog-id").value.trim();');
    L.push('    var catName=document.getElementById("new-catalog-name").value.trim();');
    L.push('    var idErr=document.getElementById("new-catalog-id-error");');
    L.push('    var nameErr=document.getElementById("new-catalog-name-error");');
    L.push('    var status=document.getElementById("new-catalog-status");');
    L.push('    var result=document.getElementById("new-catalog-result");');
    L.push('    if(idErr)idErr.style.display="none";');
    L.push('    if(nameErr)nameErr.style.display="none";');
    L.push('    if(result)result.style.display="none";');
    L.push('    if(!catId){if(idErr)idErr.style.display="block";return;}');
    L.push('    if(!catName){if(nameErr)nameErr.style.display="block";return;}');
    L.push('    btn.disabled=true;btn.textContent="Generating...";');
    L.push('    if(status){status.textContent="Writing catalog XML...";status.style.color="#54698d";}');
    L.push('    _APP.post(_APP.CREATE_CATALOG_URL,"catalogId="+encodeURIComponent(catId)+"&catalogName="+encodeURIComponent(catName),function(data){');
    L.push('      btn.disabled=false;btn.textContent="Generate XML (IMPEX)";');
    L.push('      if(!data.ok){if(status){status.textContent="Error: "+(data.error||"failed");status.style.color="#c62828";}return;}');
    L.push('      if(status){status.textContent="Done";status.style.color="#2e7d32";}');
    L.push('      var xp=document.getElementById("new-catalog-xml-path");if(xp)xp.textContent=data.xmlPath||"";');
    L.push('      if(result)result.style.display="block";');
    L.push('    });');
    L.push('  });');

    L.push('  el=document.getElementById("btn-new-catalog-impex");if(el)el.addEventListener("click",function(e){e.preventDefault();_APP.openInNewTab(_APP.IMPEX_URL);});');
    L.push('  el=document.getElementById("btn-open-bm-catalog");if(el)el.addEventListener("click",function(e){e.preventDefault();window.open("https://"+window.location.host+"/on/demandware.store/Sites-Site/default/ViewCatalogList_52-List");});');

    // Tab navigation
    L.push('  [1,2,3].forEach(function(i){var tab=document.getElementById("tab-"+i);if(tab)tab.addEventListener("click",function(){_APP.goToStep(i);});});');

    // Pre-check on load
    L.push('  _APP.post(_APP.STATUS_URL,"",function(data){');
    L.push('    if(!data.ok)return;');
    L.push('    var status=data.status||{};');
    L.push('    var missing=Object.keys(status).filter(function(k){return status[k]==="missing";});');
    L.push('    var infoBox=document.getElementById("step1-info-box");');
    L.push('    var skipBtn=document.getElementById("btn-skip-attrs");');
    L.push('    if(!missing.length){');
    L.push('      if(infoBox)infoBox.textContent="Step 1 - All 3 custom attributes (ctSlug, ctId, ctPosition) already exist. You may skip to Step 2.";');
    L.push('      if(skipBtn){skipBtn.textContent="All exist - Skip to Step 2";skipBtn.style.background="#e8f5e9";skipBtn.style.color="#2e7d32";}');
    L.push('    }else{');
    L.push('      if(infoBox)infoBox.textContent="Step 1 - Missing: "+missing.join(", ")+". Click Check Attributes to review and create.";');
    L.push('    }');
    L.push('  });');

    L.push('};');

    return L.join('\n');
}



exports.CategoryMigration = function () {
    var cfg          = require('*/cartridge/scripts/migration/configAccessor');
    var catalogId    = (cfg.sfcc && cfg.sfcc.catalogId) ? cfg.sfcc.catalogId : 'storefront-catalog-m-en';
    var Logger     = require('dw/system/Logger');
    var instanceHost = request.httpHost;

    // Build URLs safely - no special characters
    var platformId = String(session.custom.migrationPlatformId || 'commercetools');
    var pageCtx    = migrationPageContext(platformId, 'catalog');
    var impexFolderUrl = pageCtx.impexUrl;
    var importPageUrl  = 'https://' + instanceHost + '/on/demandware.store/Sites-Site/default%3bapp%3d__bm_merchant/ViewCatalogImpex_52-Status?SelectedMenuItem=prod-cat_impex&CurrentMenuItemId=prod-cat';
    var checkAttrsUrl  = URLUtils.url('Accelerator-CheckCategoryAttributes').toString() || '';
    var checkStatusUrl = URLUtils.url('Accelerator-CheckAttributeStatus').toString()    || '';
    var fetchUrl       = URLUtils.url('Accelerator-FetchCTCategories').toString()       || '';
    var migrateUrl     = URLUtils.url('Accelerator-RunCategoryMigration').toString()    || '';

    Logger.info('CategoryMigration URLs: migrate={0} impex={1} import={2}',
        migrateUrl, impexFolderUrl, importPageUrl);

    ISML.renderTemplate('accelerator/categoryMigration', withBmFrame({
        title          : 'Category Migration',
        subtitle       : '',
        catalogId      : catalogId,
        impexPath      : pageCtx.impexPath,
        dataWizardEntryUrl:  pageCtx.dataWizardEntryUrl,
        dataWizardSelectUrl: pageCtx.dataWizardSelectUrl,
        dashboardUrl   : URLUtils.url('Accelerator-Start').toString(),
        cssUrl         : URLUtils.staticURL('/css/accelerator-migration.css').toString(),
        checkAttrsUrl  : checkAttrsUrl,
        checkStatusUrl : checkStatusUrl,
        fetchUrl       : fetchUrl,
        migrateUrl     : migrateUrl,
        impexFolderUrl : impexFolderUrl,
        importPageUrl  : importPageUrl,
        fetchCatalogsUrl      : URLUtils.url('Accelerator-FetchSFCCCatalogs').toString(),
        createCatalogUrl      : URLUtils.url('Accelerator-CreateCatalog').toString(),
        createCategoryUrl     : URLUtils.url('Accelerator-CreateCategory').toString(),
        bmClientId            : (cfg.sfcc && cfg.sfcc.bmClientId)  ? cfg.sfcc.bmClientId  : '',
        metaVersion           : (cfg.sfcc && cfg.sfcc.metaVersion) ? cfg.sfcc.metaVersion : 'v20_10',
        importUrl             : importPageUrl,
        createCtCategoryUrl   : URLUtils.url('Accelerator-CreateCTCategory').toString(),
        jsUrl: URLUtils.url('Accelerator-CategoryMigrationJS').toString()
    }));
};
exports.CategoryMigration.public = true;


/**
 * Check status of required custom attribute definitions on the SFCC Category system object.
 * Returns each attr with an `exists` flag.
 * GET — no params required.
 */
exports.CheckCategoryAttributes = function () {
    try {
        var selectedParam = request.httpParameterMap.selected.stringValue;
        var deleteParam   = request.httpParameterMap.delete.stringValue;

        // No params — return current status
        if (!selectedParam && !deleteParam) {
            var categoryAttributeMgr = require('*/cartridge/scripts/catalog/categoryAttributeMgr');
            var attrs = categoryAttributeMgr.checkAttributes();
            response.setContentType('application/json');
            response.writer.print(JSON.stringify({ ok: true, attrs: attrs }));
            return;
        }

        var sfccClient = require('*/cartridge/scripts/migration/sfccClient');
        var token      = sfccClient.getSFCCToken();

        // Delete param — delete selected attributes
        if (deleteParam) {
            var toDelete = JSON.parse(deleteParam);
            var deleted  = 0;
            var dFailed  = 0;
            var dErrors  = [];
            for (var d = 0; d < toDelete.length; d++) {
                try {
                    sfccClient.deleteAttributeDefinition(token, 'Category', toDelete[d]);
                    deleted++;
                } catch (de) {
                    dFailed++;
                    dErrors.push(toDelete[d] + ': ' + (de.message || String(de)));
                }
            }
            response.setContentType('application/json');
            response.writer.print(JSON.stringify({ ok: dFailed === 0, deleted: deleted, failed: dFailed, errors: dErrors }));
            return;
        }

        // Selected param — create selected attributes
        var selected    = JSON.parse(selectedParam);
        var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');
        var existingIds = sfccClient.getExistingAttributeIds(token, 'Category');
        var created = 0; var skipped = 0; var failed = 0; var errors = [];

        try { sfccClient.ensureAttributeGroup(token, 'Category', 'CTPMigration', 'CTP Migration'); } catch (ge) {}

        for (var i = 0; i < selected.length; i++) {
            var a = selected[i];
            if (existingIds[a.id]) {
                skipped++;
                try { sfccClient.addAttributeToGroup(token, 'Category', 'CTPMigration', a.id); } catch (age) {}
                continue;
            }
            try {
                var def = attrBuilder.buildAttrDefinition(a.id, a.sfccType, a.label);
                sfccClient.createAttributeDefinition(token, 'Category', def);
                sfccClient.addAttributeToGroup(token, 'Category', 'CTPMigration', a.id);
                created++;
            } catch (e) {
                failed++;
                if (errors.length < 5) errors.push(a.id + ': ' + (e.message || String(e)));
            }
        }

        response.setContentType('application/json');
        response.writer.print(JSON.stringify({ ok: failed === 0, created: created, skipped: skipped, failed: failed, errors: errors }));

    } catch (e) {
        response.setContentType('application/json');
        response.writer.print(JSON.stringify({ ok: false, error: e.message || String(e) }));
    }
};
exports.CheckCategoryAttributes.public = true;

/**
 * Alias used by the attribute status widget (same as CheckCategoryAttributes).
 * GET — no params required.
 */
exports.CheckAttributeStatus = function () {
    var categoryAttributeMgr = require('*/cartridge/scripts/catalog/categoryAttributeMgr');
    try {
        var attrs  = categoryAttributeMgr.checkAttributes();
        var status = {};
        for (var i = 0; i < attrs.length; i++) {
            status[attrs[i].id] = attrs[i].exists ? 'exists' : 'missing';
        }
        response.setContentType('application/json');
        response.writer.print(JSON.stringify({ ok: true, status: status }));
    } catch (e) {
        response.setContentType('application/json');
        response.writer.print(JSON.stringify({ ok: false, error: e.message }));
    }
};
exports.CheckAttributeStatus.public = true;


/**
 * Create selected category attribute definitions on the SFCC Category system object.
 * POST: attrs=<json-array of {id, label, sfccType}>
 */
exports.CreateCategoryAttributes = function () {
    var rawAttrs = getParam('attrs');
    var attrs    = [];
    try { attrs = JSON.parse(rawAttrs || '[]'); } catch (e) {
        jsonResponse({ ok: false, error: 'Invalid attrs JSON' });
        return;
    }
    try {
        var catAttrs3 = require('*/cartridge/scripts/catalog/createCategoryAttributes');
        jsonResponse({ ok: true, result: catAttrs3.createMissingAttributes() });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CreateCategoryAttributes.public = true;

// Fetch all available SFCC catalogs using native CatalogMgr (no credentials needed)
exports.FetchSFCCCatalogs = function () {
    try {
        var HTTPClient  = require('dw/net/HTTPClient');
        var sfccClient  = require('*/cartridge/scripts/migration/sfccClient');
        var cfg         = require('*/cartridge/scripts/migration/configAccessor');
        var base        = 'https://' + request.httpHost;
        var version     = (cfg.sfcc && cfg.sfcc.version) ? cfg.sfcc.version : 'v20_10';
        var clientId    = (cfg.sfcc && cfg.sfcc.bmClientId) ? cfg.sfcc.bmClientId : 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

        var token = sfccClient.getSFCCToken();
        var url   = base + '/s/-/dw/data/' + version + '/catalogs?client_id=' + encodeURIComponent(clientId) + '&count=200';

        var client = new HTTPClient();
        client.setTimeout(20000);
        client.open('GET', url);
        client.setRequestHeader('Authorization', 'Bearer ' + token);
        client.setRequestHeader('Content-Type', 'application/json');
        client.send('');

        var text = client.text || '';
        var data;
        try { data = JSON.parse(text); } catch (pe) { data = {}; }

        if (client.statusCode !== 200 || !data.data) {
            // Fallback to CatalogMgr if OCAPI fails
            var CatalogMgr = require('dw/catalog/CatalogMgr');
            var Site       = require('dw/system/Site');
            var result     = [];
            var seen       = {};
            function addCat(cat) {
                if (cat && !seen[cat.ID]) {
                    seen[cat.ID] = true;
                    result.push({ id: cat.ID, name: cat.displayName ? cat.displayName.toString() : cat.ID });
                }
            }
            addCat(CatalogMgr.getSiteCatalog());
            var sites = Site.getAllSites();
            var sit = sites.iterator();
            while (sit.hasNext()) { try { addCat(sit.next().getCatalog()); } catch (se) {} }
            jsonResponse({ ok: true, catalogs: result, total: result.length });
            return;
        }

        var catalogs = data.data.map(function (c) {
            var name = (c.name && (c.name['default'] || c.name['x-default'])) || c.id;
            return { id: c.id, name: name };
        });

        jsonResponse({ ok: true, catalogs: catalogs, total: catalogs.length });
    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.FetchSFCCCatalogs.public = true;



// Create new catalog XML and write to IMPEX
exports.CreateCatalog = function () {
    var catalogId   = request.httpParameterMap.catalogId.stringValue   || '';
    var catalogName = request.httpParameterMap.catalogName.stringValue || '';

    if (!catalogId || !catalogName) {
        response.setContentType('application/json');
        response.writer.print(JSON.stringify({ ok: false, error: 'catalogId and catalogName are required' }));
        return;
    }

    try {
        var File       = require('dw/io/File');
        var FileWriter = require('dw/io/FileWriter');

        var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<catalog xmlns="http://www.demandware.com/xml/impex/catalog/2006-10-31" catalog-id="' + catalogId + '">\n'
            + '    <header>\n'
            + '        <image-settings>\n'
            + '            <internal-location base-path="/images"/>\n'
            + '            <view-types>\n'
            + '                <view-type>small</view-type>\n'
            + '                <view-type>medium</view-type>\n'
            + '                <view-type>large</view-type>\n'
            + '            </view-types>\n'
            + '        </image-settings>\n'
            + '    </header>\n'
            + '    <category category-id="root">\n'
            + '        <display-name xml:lang="x-default">' + catalogName + '</display-name>\n'
            + '        <online-flag>true</online-flag>\n'
            + '    </category>\n'
            + '</catalog>';

        var migPaths = require('*/cartridge/scripts/migration/core/migrationPaths');
        var relPath  = migPaths.getRelativePath('catalog');
        var dir      = new File(File.IMPEX + File.SEPARATOR + relPath.replace(/\//g, File.SEPARATOR));
        if (!dir.exists()) { dir.mkdirs(); }

        var fileName = 'new-catalog-' + catalogId + '.xml';
        var filePath = File.IMPEX + File.SEPARATOR + relPath.replace(/\//g, File.SEPARATOR) + File.SEPARATOR + fileName;
        var file     = new File(filePath);
        var writer   = new FileWriter(file, 'UTF-8');
        writer.write(xml);
        writer.close();

        response.setContentType('application/json');
        response.writer.print(JSON.stringify({
            ok     : true,
            xmlPath: 'IMPEX/' + relPath + '/' + fileName
        }));
    } catch (e) {
        response.setContentType('application/json');
        response.writer.print(JSON.stringify({ ok: false, error: e.message }));
    }
};
exports.CreateCatalog.public = true;

// Create a new SFCC catalog directly via OCAPI
exports.CreateCatalogOCAPI = function () {
    var catalogId   = getParam('catalogId');
    var catalogName = getParam('catalogName');

    if (!catalogId || !catalogName) {
        jsonResponse({ ok: false, error: 'catalogId and catalogName are required' });
        return;
    }

    try {
        var cfg        = require('*/cartridge/scripts/migration/configAccessor');
        var creds      = require('*/cartridge/scripts/migration/sfccCredentialsAccessor');
        var HTTPClient = require('dw/net/HTTPClient');
        var Encoding   = require('dw/crypto/Encoding');
        var Bytes      = require('dw/util/Bytes');

        var metaVersion = (cfg.sfcc && cfg.sfcc.metaVersion) ? cfg.sfcc.metaVersion : 'v20_10';
        var bmClientId  = (cfg.sfcc && cfg.sfcc.bmClientId)  ? cfg.sfcc.bmClientId  : '';
        var baseUrl     = 'https://' + request.httpHost;
        var base        = baseUrl + '/s/-/dw/data/' + metaVersion;
        var qs          = '?client_id=' + encodeURIComponent(bmClientId);

        // Forward BM session cookies so the grant gets write scope
        var dwsid         = session.sessionID || '';
        var dwsecuretoken = '';
        var stCookie      = request.httpCookies['dwsecuretoken'];
        if (stCookie) { dwsecuretoken = stCookie.value; }

        // Obtain BM User Grant token
        var credentials = Encoding.toBase64(new Bytes(creds.bmUsername + ':' + creds.bmPassword + ':' + bmClientId, 'UTF-8'));
        var tokenClient = new HTTPClient();
        tokenClient.setTimeout(30000);
        tokenClient.open('POST', baseUrl + '/dw/oauth2/access_token?client_id=' + encodeURIComponent(bmClientId));
        tokenClient.setRequestHeader('Authorization', 'Basic ' + credentials);
        tokenClient.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        if (dwsid) {
            tokenClient.setRequestHeader('Cookie', 'dwsid=' + dwsid + (dwsecuretoken ? '; dwsecuretoken=' + dwsecuretoken : ''));
        }
        tokenClient.send('grant_type=urn%3Ademandware%3Aparams%3Aoauth%3Agrant-type%3Aclient-id%3Adwsid%3Adwsecuretoken');

        var tokenText = tokenClient.text || '';
        var tokenData;
        try { tokenData = JSON.parse(tokenText); } catch (te) { tokenData = {}; }
        if (tokenClient.statusCode !== 200 || !tokenData.access_token) {
            jsonResponse({ ok: false, error: 'Token failed (' + tokenClient.statusCode + '): ' + tokenText.substring(0, 300) });
            return;
        }
        var sessionToken  = tokenData.access_token;

        // Also get the same token used by GetProductCatalogs (no session cookies) for comparison
        var sfccClient   = require('*/cartridge/scripts/migration/sfccClient');
        var readToken    = '';
        try { readToken = sfccClient.getSFCCToken(); } catch (te) { readToken = ''; }

        var payload    = JSON.stringify({ id: catalogId, name: { 'default': catalogName } });
        var catalogUrl = base + '/catalogs/' + encodeURIComponent(catalogId) + qs;

        function ocapiCall(method, url, body, tkn) {
            var c = new HTTPClient();
            c.setTimeout(20000);
            c.open(method, url);
            c.setRequestHeader('Authorization', 'Bearer ' + tkn);
            c.setRequestHeader('Content-Type', 'application/json');
            c.setRequestHeader('Accept', 'application/json');
            c.send(body || '');
            return { sc: c.statusCode, body: c.text || '' };
        }

        function faultMsg(body) {
            try {
                var d = JSON.parse(body);
                return (d.fault && d.fault.message) ? d.fault.message : (body.substring(0, 300) || '(empty)');
            } catch (fe) { return body.substring(0, 300) || '(empty)'; }
        }

        // Test GET /catalogs/{id} with read token (same as GetProductCatalogs) to confirm routing
        var diagRead = readToken ? ocapiCall('GET', catalogUrl, '', readToken) : { sc: 0, body: 'no-read-token' };

        // 1. POST /catalogs with session token
        var r1 = ocapiCall('POST', base + '/catalogs' + qs, payload, sessionToken);
        if (r1.sc === 200 || r1.sc === 201) {
            jsonResponse({ ok: true, id: catalogId, name: catalogName, method: 'POST-session' });
            return;
        }

        // 2. PUT /catalogs/{id} with session token
        var r2 = ocapiCall('PUT', catalogUrl, payload, sessionToken);
        if (r2.sc === 200 || r2.sc === 201) {
            jsonResponse({ ok: true, id: catalogId, name: catalogName, method: 'PUT-session' });
            return;
        }

        // 3. PUT /catalogs/{id} with read token (same as GetProductCatalogs)
        var r3 = readToken ? ocapiCall('PUT', catalogUrl, payload, readToken) : { sc: 0, body: 'no-read-token' };
        if (r3.sc === 200 || r3.sc === 201) {
            jsonResponse({ ok: true, id: catalogId, name: catalogName, method: 'PUT-readtoken' });
            return;
        }

        jsonResponse({
            ok   : false,
            error: 'GET-diag(readToken) ' + diagRead.sc + ': ' + faultMsg(diagRead.body) +
                   ' | POST(sessionToken) ' + r1.sc + ': ' + faultMsg(r1.body) +
                   ' | PUT(sessionToken) ' + r2.sc + ': ' + faultMsg(r2.body) +
                   ' | PUT(readToken) ' + r3.sc + ': ' + faultMsg(r3.body)
        });

    } catch (e) {
        jsonResponse({ ok: false, error: e.message || String(e) });
    }
};
exports.CreateCatalogOCAPI.public = true;

// Create new category in SFCC via CatalogMgr
exports.CreateCategory = function () {
    var catalogId    = request.httpParameterMap.catalogId.stringValue    || '';
    var categoryId   = request.httpParameterMap.categoryId.stringValue   || '';
    var categoryName = request.httpParameterMap.categoryName.stringValue || '';
    var parentId     = request.httpParameterMap.parentId.stringValue     || 'root';

    if (!catalogId || !categoryId || !categoryName) {
        response.setContentType('application/json');
        response.writer.print(JSON.stringify({ ok: false, error: 'catalogId, categoryId and categoryName are required' }));
        return;
    }

    try {
        var File       = require('dw/io/File');
        var FileWriter = require('dw/io/FileWriter');

        var parentBlock = '';
        if (parentId && parentId !== 'root') {
            parentBlock = '        <parent>' + parentId + '</parent>\n';
        }

        var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<catalog xmlns="http://www.demandware.com/xml/impex/catalog/2006-10-31" catalog-id="' + catalogId + '">\n'
            + '    <category category-id="' + categoryId + '">\n'
            + '        <display-name xml:lang="x-default">' + categoryName + '</display-name>\n'
            + '        <online-flag>true</online-flag>\n'
            + parentBlock
            + '    </category>\n'
            + '</catalog>';

        var fileName = 'new-category-' + categoryId + '.xml';
        var file     = new File(File.IMPEX + '/src/catalog/' + fileName);
        var writer   = new FileWriter(file, 'UTF-8');
        writer.write(xml);
        writer.close();

        response.setContentType('application/json');
        response.writer.print(JSON.stringify({
            ok      : true,
            xmlPath : 'IMPEX/src/catalog/' + fileName,
            message : 'XML written to IMPEX/src/catalog/' + fileName + '. Import via Administration - Site Development - Import and Export to create the category.'
        }));
    } catch (e) {
        response.setContentType('application/json');
        response.writer.print(JSON.stringify({ ok: false, error: e.message }));
    }
};
exports.CreateCategory.public = true;

exports.FetchCTCategories = function () {
    var fetchCT   = require('~/cartridge/scripts/catalog/fetchCTCategories');
    var transform = require('~/cartridge/scripts/catalog/transformCategories');
    var cfg       = require('*/cartridge/scripts/migration/configAccessor');
    var Logger    = require('dw/system/Logger');

    response.setContentType('application/json');

    try {
        var defaultLocale  = request.httpParameterMap.locale.stringValue || 'en';
        var token          = fetchCT.getCTAuthToken();

        if (!token) {
            response.writer.print(JSON.stringify({ ok: false, error: 'CT auth failed' }));
            return;
        }

        var ctCategories   = fetchCT.fetchAllCategories(token);
        var sfccCategories = transform.transformAll(ctCategories, defaultLocale);

        // Return lightweight list for hierarchy editor
        var list = sfccCategories.map(function (cat) {
            return {
                id      : cat.id,
                name    : cat.name['x-default'] || cat.id,
                parentId: cat.parentId
            };
        });

        response.writer.print(JSON.stringify({ ok: true, categories: list, total: list.length }));
    } catch (e) {
        Logger.error('FetchCTCategories error: {0}', e.message);
        response.writer.print(JSON.stringify({ ok: false, error: e.message }));
    }
};
exports.FetchCTCategories.public = true;

/**
 * Create a new category in CommerceTools.
 * POST — params: key, name, parentId (optional)
 */
exports.CreateCTCategory = function () {
    var fetchCT = require('~/cartridge/scripts/catalog/fetchCTCategories');
    var cfg     = require('*/cartridge/scripts/migration/configAccessor');
    var Logger  = require('dw/system/Logger');

    response.setContentType('application/json');

    var key      = request.httpParameterMap.key.stringValue      || '';
    var name     = request.httpParameterMap.name.stringValue     || '';
    var parentId = request.httpParameterMap.parentId.stringValue || '';

    if (!key || !name) {
        response.writer.print(JSON.stringify({ ok: false, error: 'key and name are required' }));
        return;
    }

    try {
        var token = fetchCT.getCTAuthToken();
        if (!token) {
            response.writer.print(JSON.stringify({ ok: false, error: 'CT auth failed' }));
            return;
        }

        var c      = cfg.ctp;
        var apiUrl = c.apiUrl + '/' + c.projectKey + '/categories';
        var slug   = key.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        var body = {
            key  : key,
            name : { 'en-US': name },
            slug : { 'en-US': slug }
        };
        if (parentId) {
            body.parent = { id: parentId, typeId: 'category' };
        }

        var HTTPClient = require('dw/net/HTTPClient');
        var client = new HTTPClient();
        client.setTimeout(15000);
        client.open('POST', apiUrl);
        client.setRequestHeader('Authorization', 'Bearer ' + token);
        client.setRequestHeader('Content-Type', 'application/json');
        client.send(JSON.stringify(body));

        var sc   = client.statusCode;
        var text = client.text || '';
        var data;
        try { data = JSON.parse(text); } catch (pe) { data = {}; }

        if (sc === 200 || sc === 201) {
            response.writer.print(JSON.stringify({
                ok      : true,
                id      : data.key || key,
                name    : name,
                parentId: parentId || ''
            }));
        } else {
            var errMsg = (data.message || (data.errors && data.errors[0] && data.errors[0].message)) || ('HTTP ' + sc);
            response.writer.print(JSON.stringify({ ok: false, error: errMsg }));
        }
    } catch (e) {
        Logger.error('CreateCTCategory error: {0}', e.message);
        response.writer.print(JSON.stringify({ ok: false, error: e.message }));
    }
};
exports.CreateCTCategory.public = true;

/**
 * Run category migration — stub endpoint for future implementation.
 * POST — no params required.
 */
// Make sure this export name matches the URL above
exports.RunCategoryMigration = function () {
    var Logger     = require('dw/system/Logger');
    var fetchCT    = require('~/cartridge/scripts/catalog/fetchCTCategories');
    var transform  = require('~/cartridge/scripts/catalog/transformCategories');
    var xmlBuilder = require('~/cartridge/scripts/helpers/catalogXmlBuilder');
    var importer   = require('~/cartridge/scripts/catalog/importCategories');
    var File       = require('dw/io/File');
    var FileWriter = require('dw/io/FileWriter');

    response.setContentType('application/json');

    var mode      = request.httpParameterMap.mode.stringValue      || 'xml';
    var catalogId = request.httpParameterMap.catalogId.stringValue || 'storefront-catalog-m-en';
    var locale    = request.httpParameterMap.locale.stringValue    || 'en-US';

    var overridesRaw = request.httpParameterMap.overrides.stringValue || '{}';
    var overrides    = {};
    try { overrides = JSON.parse(overridesRaw); } catch (e) { overrides = {}; }

    var extraRaw    = request.httpParameterMap.extraCategories.stringValue || '[]';
    var extraCats   = [];
    try { extraCats = JSON.parse(extraRaw); } catch (e) { extraCats = []; }

    try {
        var token = fetchCT.getCTAuthToken();
        if (!token) {
            response.writer.print(JSON.stringify({ ok: false, error: 'CT auth failed.' }));
            return;
        }

        var ctCategories = fetchCT.fetchAllCategories(token);
        if (!ctCategories || ctCategories.length === 0) {
            response.writer.print(JSON.stringify({ ok: false, error: 'No categories returned from CT.' }));
            return;
        }

        var sfccCategories = transform.transformAll(ctCategories, locale);

        // Append locally-added categories (for the selected catalog only, not saved to CT)
        for (var ei = 0; ei < extraCats.length; ei++) {
            var ec = extraCats[ei];
            if (!ec || !ec.id) continue;
            sfccCategories.push({
                id              : ec.id,
                parentId        : ec.parentId || 'root',
                name            : { 'x-default': ec.name || ec.id },
                description     : {},
                pageTitle       : {},
                pageDescription : {},
                position        : sfccCategories.length + 1,
                online          : true,
                customAttributes: {}
            });
        }

        // Apply overrides to all categories (CT + new) so parent changes work for both
        sfccCategories.forEach(function (cat) {
            var ov = overrides[cat.id];
            if (!ov) return;
            if (ov.parent   !== undefined && ov.parent   !== null) cat.parentId = ov.parent;
            if (ov.position !== undefined && ov.position !== null) cat.position = parseFloat(ov.position);
        });

        // Re-sort
        var idMap = {};
        sfccCategories.forEach(function (c) { idMap[c.id] = c; });

        function getDepth(cat, visited) {
            visited = visited || {};
            if (visited[cat.id]) return 0;
            visited[cat.id] = true;
            if (!cat.parentId || cat.parentId === 'root') return 0;
            var parent = idMap[cat.parentId];
            return parent ? 1 + getDepth(parent, visited) : 1;
        }

        sfccCategories.sort(function (a, b) {
            var da = getDepth(a);
            var db = getDepth(b);
            if (da !== db) return da - db;
            if (a.parentId === b.parentId) return (a.position || 0) - (b.position || 0);
            return 0;
        });

        if (mode === 'xml') {
            var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
            var migPaths     = require('*/cartridge/scripts/migration/core/migrationPaths');
            var relPath      = migPaths.getRelativePath('catalog');
            var dir          = new File(File.IMPEX + File.SEPARATOR + relPath.replace(/\//g, File.SEPARATOR));
            if (!dir.exists()) { dir.mkdirs(); }

            var fileName = fileResolver.resolveXmlFileName('catalog', 0, 1, 'local');
            var filePath = File.IMPEX + File.SEPARATOR + relPath.replace(/\//g, File.SEPARATOR)
                + File.SEPARATOR + fileName;
            var writer   = new FileWriter(new File(filePath), 'UTF-8');
            writer.write(xmlBuilder.buildCatalogXml(catalogId, sfccCategories));
            writer.close();

            response.writer.print(JSON.stringify({
                ok:       true,
                mode:     'xml',
                total:    sfccCategories.length,
                fileName: fileName,
                impexPath: relPath,
                xmlPath:  filePath,
                message:  'XML exported successfully (' + sfccCategories.length + ' categories).'
            }));

        } else {
            var ir = importer.importAllCategories(sfccCategories, catalogId);
            response.writer.print(JSON.stringify({
                ok     : true,
                mode   : 'ocapi',
                total  : sfccCategories.length,
                success: ir.success,
                failed : ir.failed,
                errors : ir.errors || []
            }));
        }

    } catch (e) {
        Logger.error('RunCategoryMigration error: {0}\n{1}', e.message, e.stack);
        response.writer.print(JSON.stringify({ ok: false, error: e.message }));
    }
};
exports.RunCategoryMigration.public = true;

