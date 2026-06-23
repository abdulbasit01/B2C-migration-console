'use strict';

/* global request, response, session, Packages */

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
 * @returns {boolean} whether data migration connection was verified in this session
 */
function isDataMigrationConnected() {
    var flag = session.custom.dataMigrationConnected;
    return flag === true || flag === 'true';
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
            session.custom.dataMigrationConnected = 'true';
            session.custom.migrationPlatformId    = platformId;
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
        title:         Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:      Resource.msg('accelerator.subtitle', 'accelerator', null),
        platforms:     migrationData.getPlatforms(),
        wizardUrl:     URLUtils.url('Accelerator-Wizard').toString(),
        dataWizardUrl: URLUtils.url('Accelerator-DataWizard').toString(),
        cssUrl:        URLUtils.staticURL('/css/accelerator-migration.css').toString()
    });
};
exports.Start.public = true;

/**
 * Order Migration — redirect into the data wizard order flow.
 */
exports.OrderMigration = function () {
    var platformId = getParam('platform') || String(session.custom.migrationPlatformId || 'commercetools');

    if (!isDataMigrationConnected()) {
        response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '1'));
        return;
    }

    session.custom.selectedDataType = 'order';
    response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '3'));
};
exports.OrderMigration.public = true;

/**
 * Export orders from commercetools and generate IMPEX package.
 * POST: years=1|2|3&maxCount=optional
 */
exports.ExportOrders = function () {
    var years    = parseInt(getParam('years') || String(session.custom.orderExportYears || '1'), 10);
    var maxRaw   = getParam('maxCount') || String(session.custom.orderExportMaxCount || '');
    var maxCount = maxRaw ? parseInt(maxRaw, 10) : null;

    if ([1, 2, 3].indexOf(years) < 0) {
        jsonResponse({ ok: false, error: 'Years must be 1, 2, or 3' });
        return;
    }

    try {
        var runner2 = require('*/cartridge/scripts/migration/orders/orderMigrationRunner');
        var report  = runner2.run({ years: years, maxCount: maxCount });

        session.custom.orderMigrationReport = JSON.stringify({
            ordersProcessed:   report.ordersProcessed,
            ordersValidated:   report.ordersValidated,
            ordersFailed:      report.ordersFailed,
            xmlFilesGenerated: report.xmlFilesGenerated,
            runId:             report.runId
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

    if (currentStep > 1 && !isDataMigrationConnected()) {
        response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '1'));
        return;
    }

    if (currentStep > 2 && !dataTypeId) {
        response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '2'));
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
                var impexGen = require('*/cartridge/scripts/migration/orders/generators/impexGenerator');
                if (orderReport.runId) {
                    var ordersFolder = impexGen.MIGRATION_BASE + '/' + orderReport.runId + '/'
                        + impexGen.IMPEX_SRC + '/' + impexGen.ORDERS_SUBDIR;
                    bmImpexUrl = bmLinks.getImpexFolderUrl(ordersFolder);
                } else {
                    bmImpexUrl = bmLinks.getImpexFolderUrl(impexGen.MIGRATION_BASE);
                }
            }
        } catch (e) { /* no report yet */ }
    }

    var stepContent = null;
    if (wizardStep.key === 'selectType') {
        stepContent = migrationData.buildDataSelectContent();
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
        exportComplete:         Resource.msg('accelerator.ordermigration.export.complete', 'accelerator', null)
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

    ISML.renderTemplate(pageTemplate, {
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
        orderReport:         orderReport,
        bmImpexUrl:          bmImpexUrl,
        orderYears:          String(session.custom.orderExportYears || '1'),
        orderMaxCount:       String(session.custom.orderExportMaxCount || ''),
        prevStep:            prevStep,
        nextStep:            nextStep,
        prevStepQuery:       toStepQuery(prevStep),
        nextStepQuery:       toStepQuery(nextStep),
        isLastStep:          currentStep >= maxStep,
        dashboardUrl:        URLUtils.url('Accelerator-Start').toString(),
        wizardBaseUrl:       wizardBaseUrl,
        continueUrl:         URLUtils.url('Accelerator-DataWizardContinue').toString(),
        orderConfigUrl:      URLUtils.url('Accelerator-DataWizardSaveOrderConfig').toString(),
        testConnectionUrl:   URLUtils.url('Accelerator-TestConnection').toString(),
        exportUrl:           URLUtils.url('Accelerator-ExportOrders').toString(),
        downloadUrl:         URLUtils.url('Accelerator-DownloadMigrationFile').toString(),
        dataWizardJsUrl:     URLUtils.staticURL('/js/data-wizard.js').toString(),
        cssUrl:              URLUtils.staticURL('/css/accelerator-migration.css').toString()
    });
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
        connector.testConnectionWith(buildConnectionCreds(platformId));
        session.custom.dataMigrationConnected = 'true';
        session.custom.migrationPlatformId    = platformId;

        if (platformId === 'shopify') {
            var creds = buildConnectionCreds(platformId);
            session.custom.shopifyStoreUrl     = creds.storeUrl     || '';
            session.custom.shopifyClientId     = creds.clientId     || '';
            session.custom.shopifyClientSecret = creds.clientSecret || '';
            session.custom.shopifyApiVersion   = creds.apiVersion   || '2025-01';
        }

        response.redirect(stepTwoUrl);
    } catch (e) {
        session.custom.dataMigrationConnected = 'false';
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
        response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '1'));
        return;
    }

    if (!migrationData.getDataType(typeId)) {
        response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '2'));
        return;
    }

    session.custom.selectedDataType = typeId;
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

    session.custom.orderExportYears    = String(years);
    session.custom.orderExportMaxCount = maxRaw ? String(parseInt(maxRaw, 10)) : '';
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
        response.redirect(URLUtils.url('Accelerator-DataWizard', 'platform', platformId, 'step', '1'));
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
