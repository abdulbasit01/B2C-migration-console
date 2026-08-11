'use strict';

var paths = require('*/cartridge/scripts/migration/core/migrationPaths');

module.exports = {
    MODULE_ID:            paths.MODULE_IDS.shippingMethod,
    MIGRATION_BASE:       paths.MIGRATION_BASE,
    MODULE_RELATIVE_PATH: paths.getRelativePath('shippingMethod'),
    formatRunStamp:       paths.formatRunDate,
    buildXmlFileName:     function (runDate, versionNumber) {
        return paths.buildXmlFileName('shippingMethod', runDate, versionNumber);
    }
};
