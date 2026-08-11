'use strict';

/**
 * BM credentials from Site Preferences only.
 */

var prefs = require('*/cartridge/scripts/migration/migrationPreferences');
var fromPrefs = prefs.getBmCredentials();

module.exports = {
    bmUsername: fromPrefs.bmUsername || '',
    bmPassword: fromPrefs.bmPassword || ''
};
