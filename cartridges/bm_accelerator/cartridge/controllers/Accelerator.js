'use strict';

/* global request, response, session */

var ISML          = require('dw/template/ISML');
var URLUtils      = require('dw/web/URLUtils');
var Resource      = require('dw/web/Resource');
var migrationData = require('*/cartridge/scripts/accelerator/migrationData');
var ctpClient     = require('*/cartridge/scripts/migration/ctpClient');
var runner        = require('*/cartridge/scripts/migration/runner');

/**
 * Format number with commas.
 * @param {number} n - number
 * @returns {string} formatted string
 */
function fmt(n) {
    return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Build Fetch step content using live CTP schema counts.
 * @param {Object} counts - schema counts from ctpClient.getSchemaCounts()
 * @returns {Object} stepContent for stepFetch.isml
 */
function buildFetchContent(counts) {
    return {
        titleSuffix: 'Fetch source data',
        intro:       'Live schema counts from your commercetools project.',
        sections: [
            {
                title: 'Product Schema',
                items: [
                    'Product types (' + fmt(counts.productTypes) + ')',
                    'Product attributes (' + fmt(counts.productAttributes) + ')'
                ]
            },
            {
                title: 'Custom Types',
                items: [
                    'Custom types (' + fmt(counts.customTypes) + ')',
                    'Custom fields (' + fmt(counts.customFields) + ')'
                ]
            }
        ],
        summary: 'Total schema definitions: ' + fmt((counts.productAttributes || 0) + (counts.customFields || 0))
    };
}

/**
 * Build Move step content from schema migration results.
 * @param {Object} sessionResults - results stored in BM session
 * @returns {Object} stepContent for stepMove.isml
 */
function buildMoveContent(sessionResults) {
    var tasks   = ['Product', 'Category', 'Customer', 'Order', 'ProductInventoryRecord', 'ProductList', 'ProductListItem', 'Promotion'];
    var results = sessionResults || {};
    var isDone  = Object.keys(results).length > 0;
    var phases  = [];
    var i;

    for (i = 0; i < tasks.length; i++) {
        var task   = tasks[i];
        var r      = results[task];
        var status;
        var pct;

        if (r) {
            status = r.error ? 'active' : 'done';
            pct    = r.error ? 0 : 100;
        } else {
            status = isDone ? 'pending' : 'active';
            pct    = 0;
        }

        phases.push({
            name:   task + (r && !r.error ? ' (' + fmt(r.success) + ' attrs)' : ''),
            status: status,
            pct:    pct
        });
    }

    return {
        titleSuffix: 'Run schema migration',
        intro:       isDone ? 'Schema migration complete.' : 'Creating SFCC attribute definitions from CTP schema…',
        phases:      phases
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
        var r = results[keys[i]];
        stats.push({
            label: keys[i] + ' attributes',
            value: r.error ? 'Error' : fmt(r.success || 0)
        });
    }

    if (!stats.length) {
        stats = [{ label: 'Status', value: 'No schema migration run yet' }];
    }

    return {
        titleSuffix: 'Schema migration summary',
        intro:       'Attribute definitions created in SFCC system objects.',
        stats:       stats
    };
}

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
        var parsed = parseInt(params.step.stringValue, 10);
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

    // Step 2: Fetch — live CTP schema counts
    if (currentStep === 2 && platformId === 'commercetools') {
        try {
            var schemaCounts = ctpClient.getSchemaCounts();
            stepContent = buildFetchContent(schemaCounts);
        } catch (e) { /* fallback to default */ }
    }

    // Step 4: Move — run schema migration
    if (currentStep === 4 && platformId === 'commercetools') {
        var existingResults = null;
        try { existingResults = JSON.parse(session.custom.schemaMigrationResults || 'null'); } catch (e) { /* no prior run */ }

        if (!existingResults) {
            try {
                var migrationResults = runner.runAll();
                session.custom.schemaMigrationResults = JSON.stringify(migrationResults);
                stepContent = buildMoveContent(migrationResults);
            } catch (e) {
                stepContent = buildMoveContent(null);
            }
        } else {
            stepContent = buildMoveContent(existingResults);
        }
    }

    // Step 5: View — show results from session
    if (currentStep === 5 && platformId === 'commercetools') {
        var sessionResults = null;
        try { sessionResults = JSON.parse(session.custom.schemaMigrationResults || 'null'); } catch (e) { /* no results */ }
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
