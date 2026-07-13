'use strict';

var http = require('*/cartridge/scripts/migration/core/http');
var cfg  = require('*/cartridge/scripts/migration/configAccessor');

var AUTH_URL = 'https://auth.amplience.net/oauth/token';

/**
 * Resolve Amplience credentials from request overlay or config.
 * @param {Object} [creds]
 * @returns {Object}
 */
function resolveCreds(creds) {
    var c = creds || cfg.amplience || {};
    return {
        hubName:             String(c.hubName || ''),
        personalAccessToken: String(c.personalAccessToken || ''),
        clientId:            String(c.clientId || ''),
        clientSecret:        String(c.clientSecret || ''),
        defaultDeliveryKey:  String(c.defaultDeliveryKey || '')
    };
}

/**
 * Obtain a bearer token — PAT (self-service) or OAuth client credentials.
 * @param {Object} [creds]
 * @returns {{ token: string, expiresIn: number, authMode: string }}
 */
function hasManagementCreds(creds) {
    var c   = resolveCreds(creds);
    var pat = c.personalAccessToken;
    if (pat && pat.indexOf('•') === -1) {
        return true;
    }
    return !!(c.clientId && c.clientSecret && c.clientSecret.indexOf('•') === -1);
}

function getAccessToken(creds) {
    var c = resolveCreds(creds);
    var pat = c.personalAccessToken;

    if (pat && pat.indexOf('•') === -1) {
        return { token: pat, expiresIn: 0, authMode: 'pat' };
    }

    if (!c.clientId || !c.clientSecret || c.clientSecret.indexOf('•') !== -1) {
        throw new Error(
            'Amplience credentials required. Use a Personal Access Token (Development menu in Dynamic Content) '
            + 'or an API client ID and secret from Amplience support.'
        );
    }

    var body = 'grant_type=client_credentials'
        + '&client_id=' + encodeURIComponent(c.clientId)
        + '&client_secret=' + encodeURIComponent(c.clientSecret);

    var res = http.post(
        AUTH_URL,
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    );

    if (res.status !== 200 || !res.data.access_token) {
        throw new Error('Amplience auth failed (' + res.status + '). Check API client ID and secret.');
    }

    return {
        token:     res.data.access_token,
        expiresIn: res.data.expires_in || 300,
        authMode:  'apikey'
    };
}

module.exports = {
    resolveCreds:         resolveCreds,
    hasManagementCreds:   hasManagementCreds,
    getAccessToken:       getAccessToken
};
