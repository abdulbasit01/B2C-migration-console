'use strict';

/**
 * Connector registry — maps platform IDs to connector modules.
 *
 * Each connector must implement:
 *   testConnectionWith(creds)                → { project, expiresIn }
 *   buildFetchContent(counts)                  → StepContent
 *   buildAiMapContent(selectedTasks, existing) → StepContent
 */
var connectors = {
    'commercetools': require('*/cartridge/scripts/migration/connectors/ctp/ctpConnector'),
    'shopify':       require('*/cartridge/scripts/migration/connectors/shopify/shopifyConnector'),
    'amplience':     require('*/cartridge/scripts/migration/connectors/amplience/amplienceConnector'),
    'sap':           require('*/cartridge/scripts/migration/connectors/sap/sapConnector')
};

/**
 * Retrieve a connector by platform ID.
 * @param {string} platformId
 * @returns {Object|null} connector or null if platform is not registered
 */
function get(platformId) {
    return connectors[platformId] || null;
}

/**
 * Check whether a platform ID has a registered connector.
 * @param {string} platformId
 * @returns {boolean}
 */
function isSupported(platformId) {
    return Object.prototype.hasOwnProperty.call(connectors, platformId);
}

module.exports = { get: get, isSupported: isSupported };
