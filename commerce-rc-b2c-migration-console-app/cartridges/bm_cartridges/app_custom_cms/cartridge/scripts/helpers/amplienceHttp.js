'use strict';

var HTTPClient = require('dw/net/HTTPClient');

/**
 * Minimal HTTP GET helper for storefront Amplience CDN calls.
 * @param {string} url - Request URL
 * @param {Object} [headers] - Optional request headers
 * @returns {{ status: number, data: Object, text: string }}
 */
function get(url, headers) {
    var client = new HTTPClient();
    client.setTimeout(15000);
    client.open('GET', url);

    var keys = Object.keys(headers || {});
    var i;
    for (i = 0; i < keys.length; i++) {
        client.setRequestHeader(keys[i], headers[keys[i]]);
    }

    client.send('');

    var text = client.getText() || '';
    var data = {};
    try {
        data = JSON.parse(text || '{}');
    } catch (e) {
        data = {};
    }

    return {
        status: client.getStatusCode(),
        data: data,
        text: text
    };
}

module.exports = {
    get: get
};
