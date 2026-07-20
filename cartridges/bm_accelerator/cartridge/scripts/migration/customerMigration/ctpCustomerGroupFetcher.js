'use strict';

var http     = require('*/cartridge/scripts/migration/core/http');
var cfg      = require('*/cartridge/scripts/migration/configAccessor');
var Encoding = require('dw/crypto/Encoding');
var Bytes    = require('dw/util/Bytes');

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function getToken() {
    var c    = cfg.ctp;
    var body = 'grant_type=client_credentials';
    if (c.scopes) body += '&scope=' + encodeURIComponent(c.scopes);
    var res = http.post(
        c.authUrl + '/oauth/token',
        {
            Authorization:  'Basic ' + toBase64(c.clientId + ':' + c.clientSecret),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    );
    if (res.status !== 200 || !res.data.access_token) {
        throw new Error('CTP auth failed (' + res.status + ')');
    }
    return res.data.access_token;
}

/**
 * Fetch all customer groups from CTP (up to 500).
 * @returns {Array<{ id: string, key: string, name: string }>}
 */
function fetchGroups() {
    var c   = cfg.ctp;
    var tok = getToken();
    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/customer-groups?limit=500&sort=name+asc&withTotal=true',
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CTP customer-groups fetch failed (' + res.status + ')');
    }
    var results = res.data.results || [];
    var groups  = [];
    for (var i = 0; i < results.length; i++) {
        var g = results[i];
        groups.push({
            id:   g.id,
            key:  g.key  || '',
            name: g.name || g.key || g.id
        });
    }
    return groups;
}

module.exports = { fetchGroups: fetchGroups };
