'use strict';

var runner    = require('*/cartridge/scripts/migration/core/attrPreflightRunner');
var nativeMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');

var SHOPIFY_ATTR_GROUP_ID   = 'ShopifyMigration';
var SHOPIFY_ATTR_GROUP_NAME = 'Shopify Migration';

/**
 * @returns {{ mapped: Array, missing: Array, coveragePending: Array, skipped: Array }}
 */
function checkMissingAttributes() {
    var fields = nativeMap.getMappedSourceFields('shopify', 'Customer');
    return runner.classifyFields({
        sfccObjectType: 'Profile',
        taskName:       'Customer',
        moduleKey:      'customer',
        fields:         fields
    });
}

function createAttributes(attrs) {
    return runner.createDefinitions('Profile', SHOPIFY_ATTR_GROUP_ID, SHOPIFY_ATTR_GROUP_NAME, attrs);
}

module.exports = {
    checkMissingAttributes: checkMissingAttributes,
    createAttributes:       createAttributes
};
