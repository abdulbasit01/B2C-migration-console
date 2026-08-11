'use strict';

/**
 * Amplience HTTP calls via Service Framework (accelerator.amplience.api).
 */

var serviceHttp = require('*/cartridge/scripts/migration/core/serviceHttp');

function get(url, headers) {
    return serviceHttp.get('amplience', url, headers);
}

function post(url, headers, body) {
    return serviceHttp.post('amplience', url, headers, body);
}

module.exports = {
    get:  get,
    post: post
};
