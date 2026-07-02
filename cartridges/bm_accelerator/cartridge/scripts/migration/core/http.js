'use strict';

var HTTPClient = require('dw/net/HTTPClient');

/**
 * Minimal HTTPClient wrapper used by all platform connectors.
 * Keeps raw SFCC HTTPClient usage in one place.
 */

function send(method, url, headers, body) {
    var client = new HTTPClient();
    client.setTimeout(30000);
    client.open(method, url);

    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++) {
        client.setRequestHeader(keys[i], headers[keys[i]]);
    }

    client.send(body !== undefined ? String(body) : '');

    var text = client.getText() || '';
    var data = {};
    try { data = JSON.parse(text || '{}'); } catch (e) { /* leave as empty object */ }

    return { status: client.getStatusCode(), data: data, text: text };
}

function get(url, headers) {
    return send('GET', url, headers);
}

function post(url, headers, body) {
    return send('POST', url, headers, body);
}

module.exports = { get: get, post: post };
