'use strict';

/**
 * Business Manager controller (Script API routes).
 * URLs: Accelerator-Start, Accelerator-Wizard
 */

var ISML = require('dw/template/ISML');
var URLUtils = require('dw/web/URLUtils');
var Resource = require('dw/web/Resource');
var migrationData = require('*/cartridge/scripts/accelerator/migrationData');

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
        if (!isNaN(parsed) && parsed > 0) {
            stepParam = parsed;
        }
    }

    var platform = migrationData.getPlatform(platformId);

    if (!platform || platform.status !== 'ready') {
        response.redirect(URLUtils.url('Accelerator-Start'));
        return;
    }

    var currentStep = stepParam;
    if (currentStep < 1) {
        currentStep = 1;
    }
    if (currentStep > migrationData.maxStep) {
        currentStep = migrationData.maxStep;
    }

    var wizardStep = migrationData.getWizardStep(currentStep);
    var stepContent = migrationData.getStepContent(wizardStep.key);
    var prevStep = currentStep > 1 ? currentStep - 1 : null;
    var nextStep = currentStep < migrationData.maxStep ? currentStep + 1 : null;

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
