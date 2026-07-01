'use strict';

var paths = require('*/cartridge/scripts/migration/core/migrationPaths');

module.exports = {
    MODULE_ID:            paths.MODULE_IDS.inventory,
    MIGRATION_BASE:       paths.MIGRATION_BASE,
    MODULE_RELATIVE_PATH: paths.getRelativePath('inventory'),
    buildXmlFileName: function (runDate, versionNumber) {
        return paths.buildXmlFileName('inventory', runDate, versionNumber);
    }
};
