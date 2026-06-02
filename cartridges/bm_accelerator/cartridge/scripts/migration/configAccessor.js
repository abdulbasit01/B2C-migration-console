'use strict';

var defaults = require('*/cartridge/scripts/migration/config.defaults');
var cfg = defaults;

try {
    cfg = require('*/cartridge/scripts/migration/config');
} catch (e) {
    // config.js not uploaded — dashboard still loads with defaults
}

module.exports = cfg;
