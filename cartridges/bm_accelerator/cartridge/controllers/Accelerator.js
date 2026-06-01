'use strict';

/* global request, response, session */

var ISML = require('dw/template/ISML');
var URLUtils = require('dw/web/URLUtils');
var Resource = require('dw/web/Resource');
var migrationData = require('*/cartridge/scripts/accelerator/migrationData');
var ctpClient = require('*/cartridge/scripts/migration/ctpClient');
var runner = require('*/cartridge/scripts/migration/runner');

/**
 * Format a number with commas: 12450 → '12,450'
 * @param {number} n - number to format
 * @returns {string} formatted number
 */
function fmt(n) {
    return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Build stepContent for Fetch step using live CTP entity counts.
 * @param {Object} counts - entity counts from CTP
 * @returns {Object} stepContent for stepFetch.isml
 */
function buildFetchContent(counts) {
    return {
        titleSuffix: 'Fetch source data',
        intro: 'Live entity counts from your commercetools project.',
        sections: [
            {
                title: 'Catalog',
                items: [
                    'Products (' + fmt(counts.products) + ')',
                    'Categories (' + fmt(counts.categories) + ')'
                ]
            },
            {
                title: 'Customers & Inventory',
                items: [
                    'Customers (' + fmt(counts.customers) + ')',
                    'Inventory records (' + fmt(counts.inventory) + ')'
                ]
            }
        ],
        summary: 'Total: ' + fmt(counts.products + counts.categories + counts.customers + counts.inventory) + ' records to migrate'
    };
}

/**
 * Build stepContent for Move step from migration results stored in session.
 * @param {Object} sessionResults - migration results stored in BM session
 * @returns {Object} stepContent for stepMove.isml
 */
function buildMoveContent(sessionResults) {
    var tasks = ['categories', 'products', 'customers', 'inventory'];
    var results = sessionResults || {};
    var isDone = Object.keys(results).length > 0;
    var phases = [];
    var i;

    for (i = 0; i < tasks.length; i++) {
        var task = tasks[i];
        var r = results[task];
        var name = task.charAt(0).toUpperCase() + task.slice(1);
        var phaseStatus;
        var phasePct;

        if (r) {
            phaseStatus = r.error ? 'active' : 'done';
            phasePct = r.error ? 0 : 100;
            name = r.error ? (name + ' (error)') : (name + ' (' + fmt(r.success) + ' records)');
        } else if (isDone) {
            phaseStatus = 'pending';
            phasePct = 0;
        } else {
            phaseStatus = 'active';
            phasePct = 25;
        }

        phases.push({ name: name, status: phaseStatus, pct: phasePct });
    }

    return {
        titleSuffix: 'Run migration',
        intro: isDone ? 'Migration complete. See results in the View step.' : 'Running migration from commercetools to SFCC…',
        phases: phases
    };
}

/**
 * Build stepContent for View step from session migration results.
 * @param {Object} sessionResults - migration results stored in BM session
 * @returns {Object} stepContent for stepView.isml
 */
function buildViewContent(sessionResults) {
    var labels = { categories: 'Categories', products: 'Products', customers: 'Customers', inventory: 'Inventory records' };
    var results = sessionResults || {};
    var stats = [];
    var keys = Object.keys(results);
    var i;

    for (i = 0; i < keys.length; i++) {
        var task = keys[i];
        var r = results[task];
        var label = labels[task] || task;

        if (r.error) {
            stats.push({ label: label + ' imported', value: 'Error' });
        } else {
            stats.push({ label: label + ' imported', value: fmt(r.success || 0) });
            if (r.failed > 0) {
                stats.push({ label: label + ' failed', value: fmt(r.failed) });
            }
        }
    }

    if (!stats.length) {
        stats = [{ label: 'Status', value: 'No migration run yet' }];
    }

    return {
        titleSuffix: 'Migration summary',
        intro: 'Results from this migration run.',
        stats: stats
    };
}

/**
 * Migration Console dashboard.
 */
exports.Start = function () {
    ISML.renderTemplate('accelerator/dashboard', {
        title: Resource.msg('accelerator.title', 'accelerator', null),
        subtitle: Resource.msg('accelerator.subtitle', 'accelerator', null),
        platforms: migrationData.getPlatforms(),
        wizardUrl: URLUtils.url('Accelerator-Wizard').toString(),
        cssUrl: URLUtils.staticURL('/css/accelerator-migration.css').toString()
    });
};
exports.Start.public = true;

/**
 * Multi-step migration wizard.
 */
exports.Wizard = function () {
    var params = request.httpParameterMap;
    var platformId = params.platform.stringValue || 'commercetools';
    var stepParam = 1;

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

    // Step 2: Fetch — override with live CTP counts
    if (currentStep === 2 && platformId === 'commercetools') {
        try {
            var counts = ctpClient.getEntityCounts();
            stepContent = buildFetchContent(counts);
        } catch (e) { /* fallback to default data */ }
    }

    // Step 4: Move — run migration, store results in BM session
    if (currentStep === 4 && platformId === 'commercetools') {
        var existingResults = null;
        try { existingResults = JSON.parse(session.custom.migrationResults || 'null'); } catch (e) { /* no existing job */ }

        if (!existingResults) {
            try {
                var migrationResults = runner.runAll(['categories', 'products', 'customers', 'inventory']);
                session.custom.migrationResults = JSON.stringify(migrationResults);
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
        try { sessionResults = JSON.parse(session.custom.migrationResults || 'null'); } catch (e) { /* no results */ }
        stepContent = buildViewContent(sessionResults);
        try { session.custom.migrationResults = null; } catch (e) { /* clear session */ }
    }

    ISML.renderTemplate('accelerator/wizard', {
        title: Resource.msg('accelerator.title', 'accelerator', null),
        subtitle: Resource.msg('accelerator.subtitle', 'accelerator', null),
        platform: platform,
        wizardSteps: migrationData.getWizardSteps(),
        currentStep: currentStep,
        wizardStep: wizardStep,
        stepContent: stepContent,
        prevStep: prevStep,
        nextStep: nextStep,
        nextStepLabel: migrationData.getNextStepLabel(currentStep),
        isLastStep: currentStep >= migrationData.maxStep,
        dashboardUrl: URLUtils.url('Accelerator-Start').toString(),
        wizardBaseUrl: URLUtils.url('Accelerator-Wizard', 'platform', platform.id).toString(),
        cssUrl: URLUtils.staticURL('/css/accelerator-migration.css').toString()
    });
};
exports.Wizard.public = true;
