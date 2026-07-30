'use strict';

/**
 * HTTP helper used by platform connectors — backed by Service Framework.
 */

var serviceHttp = require('*/cartridge/scripts/migration/core/serviceHttp');

function send(method, url, headers, body) {
    return serviceHttp.request('generic', method, url, headers, body);
}

function get(url, headers) {
    return send('GET', url, headers);
}

function post(url, headers, body) {
    return send('POST', url, headers, body);
}

module.exports = { get: get, post: post, send: send };
