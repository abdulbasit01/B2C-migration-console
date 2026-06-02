'use strict';

var defaults = require('*/cartridge/scripts/migration/sfcc-credentials.defaults');
var creds = defaults;

try {
    creds = require('*/cartridge/scripts/migration/sfcc-credentials');
} catch (e) {
    // sfcc-credentials.js not uploaded yet
}

module.exports = creds;
