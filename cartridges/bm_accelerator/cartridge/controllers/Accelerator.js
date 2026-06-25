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
    ISML.renderTemplate('accelerator/customerMigration', {
        title:          Resource.msg('accelerator.title', 'accelerator', null),
        subtitle:       Resource.msg('accelerator.subtitle', 'accelerator', null),
        customerListId: customerListId,
        dashboardUrl:   URLUtils.url('Accelerator-Start').toString(),
        cssUrl:         URLUtils.staticURL('/css/accelerator-migration.css').toString(),
        countUrl:       URLUtils.url('Accelerator-CustomerMigrationCount').toString(),
        profileUrl:     URLUtils.url('Accelerator-MigrateCustomerBatch').toString(),
        addressUrl:     URLUtils.url('Accelerator-MigrateCustomerAddresses').toString(),
        fullBatchUrl:        URLUtils.url('Accelerator-FullMigrationBuildBatch').toString(),
        byIdUrl:             URLUtils.url('Accelerator-MigrateCustomerById').toString(),
        customerListsUrl:    URLUtils.url('Accelerator-GetCustomerLists').toString(),
        checkAttrsUrl:       URLUtils.url('Accelerator-CheckCustomerAttributes').toString(),
        createAttrsUrl:      URLUtils.url('Accelerator-CreateCustomerAttributes').toString(),
        deleteAttrUrl:       URLUtils.url('Accelerator-DeleteCustomerAttribute').toString(),
        jobsUrl:             jobsUrl
    });
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

        var seen   = {};
        var result = [];
        var data   = body.data || [];
        for (var i = 0; i < data.length; i++) {
            var site   = data[i];
            var listId = site.customer_list_id || site.id;
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
