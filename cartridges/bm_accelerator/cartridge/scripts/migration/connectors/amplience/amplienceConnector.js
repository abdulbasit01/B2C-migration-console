'use strict';

var http    = require('*/cartridge/scripts/migration/core/amplienceApi');
var auth    = require('*/cartridge/scripts/migration/connectors/amplience/amplienceAuth');
var cfg     = require('*/cartridge/scripts/migration/configAccessor');
var cdnUtil = require('*/cartridge/scripts/migration/contentMigration/amplienceCdn');

var API_BASE = 'https://api.amplience.net/v2/content';

function findHubByName(hubs, hubName) {
    var target = String(hubName || '').toLowerCase();
    for (var i = 0; i < hubs.length; i++) {
        var hub = hubs[i];
        if (String(hub.name || '').toLowerCase() === target) {
            return hub;
        }
    }
    return null;
}

function testCdnDelivery(hubName, deliveryKey) {
    if (!deliveryKey) {
        return null;
    }
    var url = cdnUtil.buildCdnUrl(hubName, deliveryKey);
    var res = http.get(url, { 'Content-Type': 'application/json' });
    if (res.status !== 200) {
        throw new Error('Delivery key not found on CDN (' + res.status + '): ' + deliveryKey);
    }
    return res.data;
}

function validatePersonalAccessToken(pat) {
    var token = String(pat || '').trim();
    if (!token || token.indexOf('•') !== -1) {
        return 'Personal Access Token is required. Paste your amp_pat_… token from Dynamic Content → Development → Personal Access Tokens.';
    }
    if (token.indexOf('amp_pat_') !== 0) {
        return 'Personal Access Token must start with amp_pat_. Check you copied the full token from Dynamic Content.';
    }
    var secondPat = token.indexOf('amp_pat_', 8);
    if (secondPat > 0) {
        return 'Personal Access Token looks pasted twice. Copy and paste the token once only.';
    }
    return '';
}

function testConnectionWith(creds) {
    var c = auth.resolveCreds(creds);

    if (!c.hubName) {
        throw new Error('Hub name is required. Find it in Dynamic Content: Settings → Properties.');
    }

    var deliveryKey = c.defaultDeliveryKey || '';

    if (!auth.hasManagementCreds(c)) {
        if (deliveryKey) {
            testCdnDelivery(c.hubName, deliveryKey);
        }
        return {
            ok:        true,
            expiresIn: 0,
            authMode:  'cdn-only',
            project:   {
                key:  c.hubName,
                name: c.hubName + ' (CDN only — add PAT to list content)'
            }
        };
    }

    var patError = validatePersonalAccessToken(c.personalAccessToken);
    if (patError) {
        throw new Error(patError);
    }

    var authResult = auth.getAccessToken(c);
    var token      = authResult.token;

    var hubsRes = http.get(
        API_BASE + '/hubs',
        { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    );

    if (hubsRes.status === 401 || hubsRes.status === 403) {
        throw new Error('Amplience rejected the Personal Access Token (' + hubsRes.status + '). Create a new PAT and try again.');
    }

    if (hubsRes.status !== 200) {
        throw new Error('Unable to list Amplience hubs (' + hubsRes.status + '). Check your PAT and that outbound HTTP services are imported (metadata/services.xml).');
    }

    var hubs = (hubsRes.data._embedded && hubsRes.data._embedded.hubs) || [];
    var hub  = findHubByName(hubs, c.hubName);

    if (!hub) {
        throw new Error('Hub not found: ' + c.hubName + '. Check Settings → Properties in Dynamic Content.');
    }

    if (deliveryKey) {
        testCdnDelivery(c.hubName, deliveryKey);
    }

    return {
        ok:        true,
        expiresIn: authResult.expiresIn,
        authMode:  authResult.authMode,
        project:   {
            key:  hub.name,
            name: hub.label || hub.name
        }
    };
}

function testConnection() {
    return testConnectionWith(cfg.amplience);
}

function injectCredentials(fields, migCfg) {
    var config = migCfg || require('*/cartridge/scripts/migration/configAccessor');
    var a = config.amplience || {};
    var out = [];
    for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        var value = field.value;
        if (field.name === 'hubName') {
            value = a.hubName || value;
        } else if (field.name === 'personalAccessToken' && a.personalAccessToken) {
            value = '••••••••';
        } else if (field.name === 'defaultDeliveryKey') {
            value = a.defaultDeliveryKey || value;
        }
        out.push({
            name:             field.name,
            label:            field.label,
            type:             field.type,
            required:         field.required,
            value:            value,
            placeholder:      field.placeholder || '',
            secretConfigured: field.name === 'personalAccessToken' && !!a.personalAccessToken
        });
    }
    return out;
}

function emptyStepContent(title) {
    return {
        titleSuffix: title,
        intro:       'Not applicable for Amplience CMS.',
        sections:    [],
        summary:     ''
    };
}

module.exports = {
    id:                  'amplience',
    getAccessToken:      auth.getAccessToken,
    hasManagementCreds:  auth.hasManagementCreds,
    testConnectionWith:  testConnectionWith,
    testConnection:      testConnection,
    getSchemaCounts:     function () { return {}; },
    getAttrDefsForTask:  function () { return []; },
    getAttrIdsForTask:   function () { return []; },
    injectCredentials:   injectCredentials,
    getDefaultTasks:     function () { return []; },
    buildFetchContent:   function () { return emptyStepContent('CMS content'); },
    buildAiMapContent:   function () { return emptyStepContent('CMS mapping'); }
};
