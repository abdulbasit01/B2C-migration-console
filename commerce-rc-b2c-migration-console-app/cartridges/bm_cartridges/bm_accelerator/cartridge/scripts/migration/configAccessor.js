'use strict';

/**
 * Runtime migration config from Site Preferences (LINK configuration standard).
 * Empty defaults apply when prefs are not set.
 */

var defaults = require('*/cartridge/scripts/migration/config.defaults');
var prefs = require('*/cartridge/scripts/migration/migrationPreferences');

var cfg = {};
var baseKeys = Object.keys(defaults);
var i;
for (i = 0; i < baseKeys.length; i++) {
    cfg[baseKeys[i]] = defaults[baseKeys[i]];
}

module.exports = prefs.applyToConfig(cfg);
