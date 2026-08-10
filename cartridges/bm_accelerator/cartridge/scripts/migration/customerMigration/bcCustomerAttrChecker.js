'use strict';

var runner    = require('*/cartridge/scripts/migration/core/attrPreflightRunner');
var nativeMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');

var BC_ATTR_GROUP_ID   = 'BigCommerceMigration';
var BC_ATTR_GROUP_NAME = 'BigCommerce Migration';

/**
 * @returns {{ mapped: Array, missing: Array, coveragePending: Array, skipped: Array }}
 */
function checkMissingAttributes() {
    var fields = nativeMap.getMappedSourceFields('bigcommerce', 'Customer');
    return runner.classifyFields({
        sfccObjectType: 'Profile',
        taskName:       'Customer',
        moduleKey:      'customer',
        fields:         fields
    });
}

function createAttributes(attrs) {
    return runner.createDefinitions('Profile', BC_ATTR_GROUP_ID, BC_ATTR_GROUP_NAME, attrs);
}

module.exports = {
    checkMissingAttributes: checkMissingAttributes,
    createAttributes:       createAttributes
};
