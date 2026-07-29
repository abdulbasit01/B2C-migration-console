'use strict';

var amplienceApi = require('*/cartridge/scripts/migration/core/amplienceApi');
var cfg          = require('*/cartridge/scripts/migration/configAccessor');

/**
 * Resolve Amplience credentials from Site Preferences.
 * @param {Object} [creds]
 * @returns {Object}
 */
function resolveCreds(creds) {
    var c = creds || cfg.amplience || {};
    return {
        hubName:             String(c.hubName || ''),
        personalAccessToken: String(c.personalAccessToken || ''),
        defaultDeliveryKey:  String(c.defaultDeliveryKey || '')
    };
}

/**
 * Whether Management API calls are possible (requires a PAT).
 * @param {Object} [creds]
 * @returns {boolean}
 */
function hasManagementCreds(creds) {
    var pat = resolveCreds(creds).personalAccessToken;
    return !!(pat && pat.indexOf('•') === -1);
}

/**
 * Obtain a bearer token from the configured Personal Access Token.
 * @param {Object} [creds]
 * @returns {{ token: string, expiresIn: number, authMode: string }}
 */
function getAccessToken(creds) {
    var c = resolveCreds(creds);
    var pat = c.personalAccessToken;

    if (!pat || pat.indexOf('•') !== -1) {
        throw new Error(
            'Amplience Personal Access Token is required. Create one under Dynamic Content → Development → Personal Access Tokens.'
        );
    }

    return { token: pat, expiresIn: 0, authMode: 'pat' };
}

module.exports = {
    resolveCreds:       resolveCreds,
    hasManagementCreds: hasManagementCreds,
    getAccessToken:     getAccessToken
};
