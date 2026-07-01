'use strict';

var URLUtils = require('dw/web/URLUtils');

/**
 * Persist a successful data-wizard connection with optional OAuth TTL.
 * @param {string} platformId
 * @param {number} [expiresInSeconds]
 */
function markConnected(platformId, expiresInSeconds) {
    session.custom.dataMigrationConnected = 'true';
    session.custom.migrationPlatformId    = platformId;
    if (expiresInSeconds && expiresInSeconds > 0) {
        session.custom.dataMigrationTokenExpiresAt = String(Date.now() + (expiresInSeconds * 1000));
    } else {
        delete session.custom.dataMigrationTokenExpiresAt;
    }
}

function clearConnection() {
    session.custom.dataMigrationConnected = 'false';
    delete session.custom.dataMigrationTokenExpiresAt;
}

/**
 * @returns {boolean} whether connect step can be skipped
 */
function isConnected() {
    var flag = session.custom.dataMigrationConnected;
    if (flag !== true && flag !== 'true') {
        return false;
    }
    var expiresAt = session.custom.dataMigrationTokenExpiresAt;
    if (!expiresAt) {
        return true;
    }
    if (Date.now() >= parseInt(expiresAt, 10)) {
        clearConnection();
        return false;
    }
    return true;
}

/**
 * Step param for Data Wizard entry when connect may be skipped.
 * @returns {string} '1' or '2'
 */
function connectOrSelectStep() {
    return isConnected() ? '2' : '1';
}

/**
 * @param {string} platformId
 * @returns {string}
 */
function dataWizardUrl(platformId) {
    return URLUtils.url(
        'Accelerator-DataWizard',
        'platform', platformId,
        'step', connectOrSelectStep()
    ).toString();
}

/**
 * @param {string} platformId
 * @returns {string}
 */
function dataWizardSelectUrl(platformId) {
    return dataWizardUrl(platformId);
}

module.exports = {
    markConnected:       markConnected,
    clearConnection:     clearConnection,
    isConnected:         isConnected,
    connectOrSelectStep: connectOrSelectStep,
    dataWizardUrl:       dataWizardUrl,
    dataWizardSelectUrl: dataWizardSelectUrl
};
