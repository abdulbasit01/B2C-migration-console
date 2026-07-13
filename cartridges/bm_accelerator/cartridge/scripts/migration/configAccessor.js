'use strict';

var defaults = require('*/cartridge/scripts/migration/config.defaults');
var base = defaults;

try {
    base = require('*/cartridge/scripts/migration/config');
} catch (e) {
    // config.js not uploaded — dashboard still loads with defaults
}

// Shallow-clone so overlays never mutate the file config
var cfg = {};
var baseKeys = Object.keys(base);
for (var i = 0; i < baseKeys.length; i++) {
    cfg[baseKeys[i]] = base[baseKeys[i]];
}

// Overlay Shopify credentials from saved config file (persists across sessions)
try {
    var File       = require('dw/io/File');
    var FileReader = require('dw/io/FileReader');
    var configFile = new File(File.IMPEX + '/src/migration/shopify-config.json');
    if (configFile.exists()) {
        var fr   = new FileReader(configFile, 'UTF-8');
        var line; var raw = '';
        while ((line = fr.readLine()) !== null) { raw += line; }
        fr.close();
        var saved = JSON.parse(raw);
        if (saved && saved.storeUrl) {
            cfg.shopify = {
                storeUrl:     saved.storeUrl     || '',
                clientId:     saved.clientId     || '',
                clientSecret: saved.clientSecret || '',
                apiVersion:   saved.apiVersion   || '2025-01'
            };
        }
    }
} catch (e) {
    // file not found or parse error — fall through to session overlay
}

// Overlay Shopify credentials saved to session during TestConnection (trumps file)
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

        var ampHub     = String(session.custom.amplienceHubName || '');
        var ampPat     = String(session.custom.ampliencePersonalAccessToken || '');
        var ampId      = String(session.custom.amplienceClientId || '');
        var ampSecret  = String(session.custom.amplienceClientSecret || '');
        var ampKey     = String(session.custom.amplienceDefaultDeliveryKey || '');
        if (ampHub || ampPat || ampId || ampSecret) {
            cfg.amplience = {
                hubName:             ampHub    || (base.amplience ? base.amplience.hubName             : ''),
                personalAccessToken: ampPat    || (base.amplience ? base.amplience.personalAccessToken : ''),
                clientId:            ampId     || (base.amplience ? base.amplience.clientId            : ''),
                clientSecret:        ampSecret || (base.amplience ? base.amplience.clientSecret        : ''),
                defaultDeliveryKey:  ampKey    || (base.amplience ? base.amplience.defaultDeliveryKey  : '')
            };
        }
    }
} catch (e) {
    // session not in scope (unit tests) — use file config as-is
}

module.exports = cfg;
