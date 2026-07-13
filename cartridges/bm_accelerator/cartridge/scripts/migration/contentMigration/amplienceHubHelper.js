'use strict';

var http = require('*/cartridge/scripts/migration/core/http');
var auth = require('*/cartridge/scripts/migration/connectors/amplience/amplienceAuth');

var API_BASE = 'https://api.amplience.net/v2/content';

function authHeaders(token) {
    return {
        Authorization:  'Bearer ' + token,
        'Content-Type': 'application/json'
    };
}

function findHub(hubs, hubName) {
    var target = String(hubName || '').toLowerCase();
    for (var i = 0; i < hubs.length; i++) {
        if (String(hubs[i].name || '').toLowerCase() === target) {
            return hubs[i];
        }
    }
    return null;
}

function getHubContext() {
    var c     = auth.resolveCreds();
    var token = auth.getAccessToken(c).token;
    var hubsRes = http.get(API_BASE + '/hubs', authHeaders(token));

    if (hubsRes.status !== 200) {
        throw new Error('Unable to list hubs (' + hubsRes.status + ')');
    }

    var hubs = (hubsRes.data._embedded && hubsRes.data._embedded.hubs) || [];
    var hub  = findHub(hubs, c.hubName);
    if (!hub) {
        throw new Error('Hub not found: ' + c.hubName);
    }

    return { token: token, hub: hub, config: c };
}

module.exports = {
    API_BASE:     API_BASE,
    authHeaders:  authHeaders,
    getHubContext: getHubContext
};
