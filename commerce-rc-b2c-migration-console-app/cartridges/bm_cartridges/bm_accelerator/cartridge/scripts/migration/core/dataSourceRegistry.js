'use strict';

var MODULE_FETCHERS = {
    inventory: {
        commercetools: '*/cartridge/scripts/migration/inventoryMigration/ctpInventoryFetcher',
        shopify:       '*/cartridge/scripts/migration/inventoryMigration/shopifyInventoryFetcher',
        bigcommerce:   '*/cartridge/scripts/migration/inventoryMigration/bcInventoryFetcher'
    },
    store: {
        commercetools: '*/cartridge/scripts/migration/storeMigration/ctpStoreFetcher',
        shopify:       '*/cartridge/scripts/migration/storeMigration/shopifyStoreFetcher',
        sap:           '*/cartridge/scripts/migration/storeMigration/sapStoreFetcher',
        bigcommerce:   '*/cartridge/scripts/migration/storeMigration/bcStoreFetcher'
    },
    pricebook: {
        commercetools: '*/cartridge/scripts/migration/pricebookMigration/ctpPricebookFetcher',
        shopify:       '*/cartridge/scripts/migration/pricebookMigration/shopifyPricebookFetcher',
        sap:           '*/cartridge/scripts/migration/pricebookMigration/sapPricebookFetcher',
        bigcommerce:   '*/cartridge/scripts/migration/pricebookMigration/bcPricebookFetcher'
    },
    pricebookEmbedded: {
        commercetools: '*/cartridge/scripts/migration/pricebookMigration/ctpEmbeddedPriceFetcher',
        shopify:       '*/cartridge/scripts/migration/pricebookMigration/shopifyPricebookFetcher',
        sap:           '*/cartridge/scripts/migration/pricebookMigration/sapPricebookFetcher',
        bigcommerce:   '*/cartridge/scripts/migration/pricebookMigration/bcPricebookFetcher'
    },
    tax: {
        commercetools: '*/cartridge/scripts/migration/taxMigration/ctpTaxFetcher',
        shopify:       '*/cartridge/scripts/migration/taxMigration/shopifyTaxFetcher',
        bigcommerce:   '*/cartridge/scripts/migration/taxMigration/bcTaxFetcher'
    },
    shippingMethod: {
        commercetools: '*/cartridge/scripts/migration/shippingMethodMigration/ctpShippingMethodFetcher',
        shopify:       '*/cartridge/scripts/migration/shippingMethodMigration/shopifyShippingMethodFetcher',
        bigcommerce:   '*/cartridge/scripts/migration/shippingMethodMigration/bcShippingMethodFetcher'
    },
    order: {
        commercetools: '*/cartridge/scripts/migration/orders/connectors/ctpOrderConnector',
        shopify:       '*/cartridge/scripts/migration/orders/connectors/shopifyOrderConnector',
        bigcommerce:   '*/cartridge/scripts/migration/orders/connectors/bigcommerceOrderConnector'
    }
};

var MODULE_MAPPERS = {
    order: {
        commercetools: '*/cartridge/scripts/migration/orders/mappers/ctpOrderMapper',
        shopify:       '*/cartridge/scripts/migration/orders/mappers/shopifyOrderMapper',
        bigcommerce:   '*/cartridge/scripts/migration/orders/mappers/bigcommerceOrderMapper'
    }
};

/**
 * @returns {string}
 */
function getPlatformId() {
    try {
        /* global session */
        if (session && session.custom) {
            if (session.custom.migrationPlatformId) {
                return String(session.custom.migrationPlatformId);
            }
            if (session.custom.dataMigrationConnectedPlatform) {
                return String(session.custom.dataMigrationConnectedPlatform);
            }
        }
    } catch (e) {
        /* session not in scope */
    }
    return 'commercetools';
}

/**
 * @param {string} moduleKey
 * @param {string} [platformId]
 * @returns {Object}
 */
function getFetcher(moduleKey, platformId) {
    var platform = platformId || getPlatformId();
    var map      = MODULE_FETCHERS[moduleKey];
    if (!map) {
        throw new Error('Unknown migration module: ' + moduleKey);
    }
    var path = map[platform] || map.commercetools;
    return require(path);
}

/**
 * @param {string} moduleKey
 * @param {string} [platformId]
 * @returns {Object}
 */
function getMapper(moduleKey, platformId) {
    var platform = platformId || getPlatformId();
    var map      = MODULE_MAPPERS[moduleKey];
    if (!map) {
        throw new Error('No mapper for module: ' + moduleKey);
    }
    var path = map[platform] || map.commercetools;
    return require(path);
}

/**
 * @param {string} [platformId]
 * @returns {string}
 */
function getSourceLabel(platformId) {
    var platformUiMeta = require('*/cartridge/scripts/accelerator/platformUiMeta');
    return platformUiMeta.getPlatformUiMeta(platformId).sourceName;
}

module.exports = {
    getPlatformId:  getPlatformId,
    getFetcher:     getFetcher,
    getMapper:      getMapper,
    getSourceLabel: getSourceLabel
};
