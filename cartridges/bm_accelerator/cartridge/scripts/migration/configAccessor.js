'use strict';

/**
 * Runtime migration config from Site Preferences (LINK configuration standard).
 * Empty defaults apply when prefs are not set.
 */

var defaults = require('*/cartridge/scripts/migration/config.defaults');
var prefs = require('*/cartridge/scripts/migration/migrationPreferences');

var cfg = {};
var baseKeys = Object.keys(defaults);
var i;
for (i = 0; i < baseKeys.length; i++) {
    cfg[baseKeys[i]] = defaults[baseKeys[i]];
}

cfg = prefs.applyToConfig(cfg);

// Local dev / upload: overlay Amplience credentials from auto-generated config.js (.env).
try {
    var fileCfg = require('*/cartridge/scripts/migration/config');
    if (fileCfg && fileCfg.amplience) {
        cfg.amplience = cfg.amplience || {};
        if (fileCfg.amplience.hubName) {
            cfg.amplience.hubName = fileCfg.amplience.hubName;
        }
        if (fileCfg.amplience.personalAccessToken) {
            cfg.amplience.personalAccessToken = fileCfg.amplience.personalAccessToken;
        }
        if (fileCfg.amplience.clientId) {
            cfg.amplience.clientId = fileCfg.amplience.clientId;
        }
        if (fileCfg.amplience.clientSecret) {
            cfg.amplience.clientSecret = fileCfg.amplience.clientSecret;
        }
        if (fileCfg.amplience.defaultDeliveryKey) {
            cfg.amplience.defaultDeliveryKey = fileCfg.amplience.defaultDeliveryKey;
        }
    }
} catch (e) {
    // config.js not generated — run npm run config:generate
}

// Amplience BM wizard: overlay session credentials saved during TestConnection.
try {
    /* global session */
    if (session && session.custom) {
        var ampHub = String(session.custom.amplienceHubName || '');
        var ampPat = String(session.custom.ampliencePersonalAccessToken || '');
        var ampId = String(session.custom.amplienceClientId || '');
        var ampSecret = String(session.custom.amplienceClientSecret || '');
        var ampKey = String(session.custom.amplienceDefaultDeliveryKey || '');
        if (ampHub || ampPat || ampId || ampSecret) {
            cfg.amplience = cfg.amplience || {};
            cfg.amplience.hubName = ampHub || cfg.amplience.hubName || '';
            cfg.amplience.personalAccessToken = ampPat || cfg.amplience.personalAccessToken || '';
            cfg.amplience.clientId = ampId || cfg.amplience.clientId || '';
            cfg.amplience.clientSecret = ampSecret || cfg.amplience.clientSecret || '';
            cfg.amplience.defaultDeliveryKey = ampKey || cfg.amplience.defaultDeliveryKey || '';
        }
    }
} catch (e) {
    // session not in scope (unit tests)
}

module.exports = cfg;
