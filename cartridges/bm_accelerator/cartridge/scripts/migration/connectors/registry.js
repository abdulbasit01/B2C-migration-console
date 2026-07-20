'use strict';

/**
 * Connector registry — single source of truth for all supported platforms.
 *
 * Adding a new platform requires only:
 *   1. Create connectors/<platform>/index.js implementing the connector interface.
 *   2. Register it here with its platform ID.
 *   3. No changes to any other file.
 *
 * Connector interface (all methods required):
 *   id                 {string}
 *   testConnectionWith(creds)                  → { ok, project: { key, name } }
 *   testConnection()                           → { ok, project: { key, name } }
 *   getSchemaCounts()                          → Object
 *   getAttrDefsForTask(task)                   → AttrDef[]
 *   getAttrIdsForTask(task)                    → string[]
 *   injectCredentials(fields, config)          → fields[]
 *   getDefaultTasks()                          → string[]
 *   buildFetchContent(counts)                  → StepContent
 *   buildAiMapContent(selectedTasks, existing) → StepContent
 */
var connectors = {
    'commercetools': require('*/cartridge/scripts/migration/connectors/ctp/ctpConnector'),
    'shopify':       require('*/cartridge/scripts/migration/connectors/shopify/shopifyConnector')
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
