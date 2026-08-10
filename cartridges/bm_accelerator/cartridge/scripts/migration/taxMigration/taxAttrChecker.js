'use strict';

var runner = require('*/cartridge/scripts/migration/core/attrPreflightRunner');

var SFCC_OBJECT_TYPE = 'TaxClass';

function getCtpTaxCategoryFields() {
    return [];
}

function checkMissingAttributes() {
    var attrIdMapSession = require('*/cartridge/scripts/migration/core/attrIdMapSession');
    return runner.checkMissing(
        SFCC_OBJECT_TYPE,
        getCtpTaxCategoryFields,
        null,
        attrIdMapSession.read('tax'),
        'tax',
        'TaxClass'
    );
}

function createAttributes(attrs) {
    return runner.createAttributes(SFCC_OBJECT_TYPE, attrs);
}

module.exports = {
    checkMissingAttributes: checkMissingAttributes,
    createAttributes:       createAttributes
};
