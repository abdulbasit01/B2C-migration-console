'use strict';

/**
 * Per-platform display labels for migration UI.
 * Add a new connector here — module copy in migrationData.getMigrationUi uses pickStr().
 */
var PLATFORM_UI_META = {
    commercetools: {
        sourceName:    'Commercetools',
        sourceShort:   'CT',
        sourceTypeCol: 'CT Type'
    },
    shopify: {
        sourceName:    'Shopify',
        sourceShort:   'Shopify',
        sourceTypeCol: 'Source Type'
    },
    bigcommerce: {
        sourceName:    'BigCommerce',
        sourceShort:   'BigCommerce',
        sourceTypeCol: 'Source Type'
    },
    sap: {
        sourceName:    'SAP Commerce',
        sourceShort:   'SAP',
        sourceTypeCol: 'Source Type'
    }
};

/**
 * @param {string} [platformId]
 * @returns {{ sourceName: string, sourceShort: string, sourceTypeCol: string }}
 */
function getPlatformUiMeta(platformId) {
    var id = platformId || 'commercetools';
    if (PLATFORM_UI_META[id]) {
        return PLATFORM_UI_META[id];
    }
    var label = id.charAt(0).toUpperCase() + id.slice(1);
    return {
        sourceName:    label,
        sourceShort:   label,
        sourceTypeCol: 'Source Type'
    };
}

/**
 * Pick platform-specific copy. Falls back to commercetools, then _generic template.
 * @param {string} platformId
 * @param {Object} map - keys: platform ids, commercetools, optional _generic with {src}/{short}
 * @returns {string}
 */
function pickStr(platformId, map) {
    if (!map) return '';
    var id = platformId || 'commercetools';
    if (map[id]) return map[id];
    if (map._generic) {
        var meta = getPlatformUiMeta(id);
        return String(map._generic)
            .replace(/\{short\}/g, meta.sourceShort)
            .replace(/\{src\}/g, meta.sourceName);
    }
    if (map.commercetools) return map.commercetools;
    return '';
}

/**
 * Shared attribute-preflight and action labels derived from platform meta.
 * @param {string} platformId
 * @returns {Object}
 */
function getCommonUiLabels(platformId) {
    var meta  = getPlatformUiMeta(platformId);
    var short = meta.sourceShort;
    var src   = meta.sourceName;

    return {
        sourceName:         meta.sourceName,
        sourceShort:        meta.sourceShort,
        sourceTypeCol:      meta.sourceTypeCol,
        attrCheckBtn:       'Check ' + short + ' Attributes',
        attrRecheckBtn:     'Re-check',
        attrCheckingBtn:    'Checking...',
        checkingAttrs:      'Checking attributes...',
        attrModalTitle:     'Missing ' + short + ' Attributes in SFCC',
        allAttrsExist:      'All ' + short + ' attributes already exist in SFCC.',
        orderAllAttrsExist: 'All ' + short + ' order attributes already exist in SFCC.',
        attrsMissing:       ' attribute(s) found in ' + short + ' but missing in SFCC. ',
        attrsMissingCount:  ' attribute(s) missing in SFCC:',
        attrsMissingBrief:  ' attribute(s) missing.',
        attrsMissingPeriod: ' attribute(s) missing in SFCC.',
        attrsAllInSync:     'All in sync.',
        attrCheckFailed:    'Check failed',
        attrCheckError:     'Could not check ' + short + ' attributes:',
        attrScopeUnsupportedWarn:
            'SFCC does not support localizable or site-specific attributes on this object. '
            + 'Source attributes that are localized (mapped or newly created) will not remain localized after migration; '
            + 'values are stored as a single non-localized value.',
        attrScopeUnsupportedObjectsCustomer:
            'Applies to Customer / Profile and customer address attributes.',
        attrScopeUnsupportedObjectsOrder:
            'Applies to Order attributes.',
        attrScopeUnsupportedObjectsPricebook:
            'Applies to PriceBook attributes.',
        attrScopeUnsupportedObjectsInventory:
            'Applies to ProductInventoryList and ProductInventoryRecord attributes.',
        orderCountChecking: 'Checking ' + src + '...',
        pbDescStandalone:   pickStr(platformId, {
            shopify:       'Shopify variant prices',
            commercetools: 'Commercetools standalone prices',
            sap:           'SAP Commerce product prices'
        }),
        pbDescEmbedded: pickStr(platformId, {
            shopify:       'Shopify embedded product prices',
            commercetools: 'Commercetools embedded product prices',
            sap:           'SAP Commerce embedded product prices'
        })
    };
}

/**
 * IMPEX pricebook header description (platform-aware).
 * @param {string} [platformId]
 * @param {string} currency
 * @param {string} [channelId]
 * @param {boolean} [aggregate]
 * @param {boolean} [embeddedSource]
 * @returns {string}
 */
function buildPricebookDescription(platformId, currency, channelId, aggregate, embeddedSource) {
    var id = platformId || 'commercetools';
    var cur = currency || 'USD';
    var desc;

    if (embeddedSource) {
        desc = pickStr(id, {
            shopify:       'Shopify embedded variant prices (' + cur + ')',
            commercetools: 'Commercetools embedded product prices (' + cur + ')',
            sap:           'SAP Commerce embedded product prices (' + cur + ')'
        });
    } else {
        desc = pickStr(id, {
            shopify:       'Shopify variant-price migration (' + cur + ')',
            commercetools: 'Commercetools standalone-price migration (' + cur + ')',
            sap:           'SAP Commerce product-price migration (' + cur + ')'
        });
    }

    if (aggregate) {
        desc += pickStr(id, {
            shopify:       ' - store catalog',
            commercetools: ' - all channels',
            sap:           ' - store catalog'
        });
    } else if (channelId) {
        desc += ' - channel ' + channelId;
    }

    return desc;
}

/**
 * Default tax-class description when source has no description field.
 * @param {string} [platformId]
 * @param {string} classId
 * @returns {string}
 */
function buildTaxCategoryDescription(platformId, classId) {
    var id = classId || 'standard';
    return pickStr(platformId || 'commercetools', {
        shopify:       'Shopify tax category ' + id,
        commercetools: 'Commercetools tax category ' + id
    });
}

module.exports = {
    PLATFORM_UI_META:  PLATFORM_UI_META,
    getPlatformUiMeta: getPlatformUiMeta,
    pickStr:           pickStr,
    getCommonUiLabels: getCommonUiLabels,
    buildPricebookDescription: buildPricebookDescription,
    buildTaxCategoryDescription: buildTaxCategoryDescription
};
