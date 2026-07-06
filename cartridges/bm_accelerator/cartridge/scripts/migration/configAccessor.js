'use strict';

var defaults = require('*/cartridge/scripts/migration/config.defaults');
var base = defaults;

try {
    base = require('*/cartridge/scripts/migration/config');
} catch (e) {
    // config.js not uploaded — dashboard still loads with defaults
}

// Shallow-clone so session overlay never mutates the file config
var cfg = {};
var baseKeys = Object.keys(base);
for (var i = 0; i < baseKeys.length; i++) {
    cfg[baseKeys[i]] = base[baseKeys[i]];
}

// Overlay Shopify credentials saved to session during Step 1 TestConnection
try {
    /* global session */
    if (session && session.custom) {
        var sessionUrl    = String(session.custom.shopifyStoreUrl     || '');
        var sessionId     = String(session.custom.shopifyClientId     || '');
        var sessionSecret = String(session.custom.shopifyClientSecret || '');
        var sessionToken  = String(session.custom.shopifyAccessToken  || '');
        var sessionVer    = String(session.custom.shopifyApiVersion   || '');
        if (sessionUrl || sessionId || sessionToken) {
            cfg.shopify = {
                storeUrl:     sessionUrl    || (base.shopify ? base.shopify.storeUrl     : ''),
                clientId:     sessionId     || (base.shopify ? base.shopify.clientId     : ''),
                clientSecret: sessionSecret || (base.shopify ? base.shopify.clientSecret : ''),
                accessToken:  sessionToken  || (base.shopify ? base.shopify.accessToken  : ''),
                apiVersion:   sessionVer    || (base.shopify ? base.shopify.apiVersion   : '2026-07')
            };
        }
    }
} catch (e) {
    // session not in scope (unit tests) — use file config as-is
}

module.exports = cfg;
