'use strict';

var URLUtils = require('dw/web/URLUtils');

/**
 * Persist a successful data-wizard connection with optional OAuth TTL.
 * Connection is scoped to one platform — switching platforms requires reconnect.
 * @param {string} platformId
 * @param {number} [expiresInSeconds]
 */
function markConnected(platformId, expiresInSeconds) {
    session.custom.dataMigrationConnected         = 'true';
    session.custom.dataMigrationConnectedPlatform = String(platformId || '');
    session.custom.migrationPlatformId          = String(platformId || '');
    if (expiresInSeconds && expiresInSeconds > 0) {
        session.custom.dataMigrationTokenExpiresAt = String(Date.now() + (expiresInSeconds * 1000));
    } else {
        delete session.custom.dataMigrationTokenExpiresAt;
    }
}

function clearShopifySessionCreds() {
    delete session.custom.shopifyStoreUrl;
    delete session.custom.shopifyClientId;
    delete session.custom.shopifyClientSecret;
    delete session.custom.shopifyAccessToken;
    delete session.custom.shopifyApiVersion;
}

function clearAmplienceSessionCreds() {
    delete session.custom.amplienceHubName;
    delete session.custom.ampliencePersonalAccessToken;
    delete session.custom.amplienceClientId;
    delete session.custom.amplienceClientSecret;
    delete session.custom.amplienceDefaultDeliveryKey;
}

function clearConnection() {
    session.custom.dataMigrationConnected = 'false';
    delete session.custom.dataMigrationConnectedPlatform;
    delete session.custom.migrationPlatformId;
    delete session.custom.dataMigrationTokenExpiresAt;
    delete session.custom.selectedDataType;
    clearShopifySessionCreds();
    clearAmplienceSessionCreds();
}

/**
 * @returns {string}
 */
function getConnectedPlatform() {
    return String(session.custom.dataMigrationConnectedPlatform || '');
}

/**
 * @param {string} [platformId] - when provided, connection must match this platform
 * @returns {boolean} whether connect step can be skipped
 */
function isConnected(platformId) {
    var flag = session.custom.dataMigrationConnected;
    if (flag !== true && flag !== 'true') {
        return false;
    }

    if (platformId && getConnectedPlatform() !== String(platformId)) {
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
 * @param {string} platformId
 * @returns {string} '1' or '2'
 */
function connectOrSelectStep(platformId) {
    return isConnected(platformId) ? '2' : '1';
}

/**
 * @param {string} platformId
 * @returns {string}
 */
function dataWizardUrl(platformId) {
    return URLUtils.url(
        'Accelerator-DataWizard',
        'platform', platformId,
        'step', connectOrSelectStep(platformId)
    ).toString();
}

/**
 * @param {string} platformId
 * @returns {string} Data Wizard step 2 (Select Data)
 */
function dataWizardSelectUrl(platformId) {
    return URLUtils.url(
        'Accelerator-DataWizard',
        'platform', platformId,
        'step', '2'
    ).toString();
}

module.exports = {
    markConnected:       markConnected,
    clearConnection:     clearConnection,
    getConnectedPlatform: getConnectedPlatform,
    isConnected:         isConnected,
    connectOrSelectStep: connectOrSelectStep,
    dataWizardUrl:       dataWizardUrl,
    dataWizardSelectUrl: dataWizardSelectUrl
};
