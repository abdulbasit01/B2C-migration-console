'use strict';

/**
 * Synthetic commercetools bulk fixtures for offline migration pipeline testing.
 *
 * Scale (set BULK_TEST_SCALE or BULK_TEST_SIZE):
 *   normal  — thousands (default): 5k–50k records per module
 *   stress  — hundreds of thousands
 *   million — up to 1M for paginated modules (shipping, inventory, prices)
 *
 * npm run test:bulk
 * npm run test:bulk:stress
 * npm run test:bulk:million
 */

var SCALES = {
    normal: {
        shipping:            5000,
        inventory:           50000,
        standalonePrices:    50000,
        embeddedProducts:    10000,
        taxCategories:       200,
        taxRatesPerCategory: 50,
        stores:              5000,
        storeChannels:       500,
        inventoryChannels:   10,
        pricebookChannels:   8
    },
    stress: {
        shipping:            100000,
        inventory:           500000,
        standalonePrices:    500000,
        embeddedProducts:    100000,
        taxCategories:       500,
        taxRatesPerCategory: 100,
        stores:              50000,
        storeChannels:       2000,
        inventoryChannels:   20,
        pricebookChannels:   16
    },
    million: {
        shipping:            1000000,
        inventory:           1000000,
        standalonePrices:    1000000,
        embeddedProducts:    250000,
        taxCategories:       1000,
        taxRatesPerCategory: 100,
        stores:              100000,
        storeChannels:       5000,
        inventoryChannels:   50,
        pricebookChannels:   32
    }
};

function getScaleName() {
    var name = String(process.env.BULK_TEST_SCALE || 'normal').toLowerCase();
    return SCALES[name] ? name : 'normal';
}

function getScale() {
    return SCALES[getScaleName()];
}

/**
 * Target record count for a module key (overridden by BULK_TEST_SIZE).
 * @param {string} key
 * @returns {number}
 */
function targetCount(key) {
    var raw = process.env.BULK_TEST_SIZE;
    if (raw) {
        var n = parseInt(raw, 10);
        if (!isNaN(n) && n > 0) return n;
    }
    var scale = getScale();
    return scale[key] || scale.shipping;
}

/** @deprecated use targetCount(key) */
function bulkSize(fallback) {
    if (process.env.BULK_TEST_SIZE) {
        return targetCount('shipping');
    }
    return fallback;
}

function padNum(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
}

function uuidLike(prefix, index) {
    return prefix + '-' + padNum(index, 8) + '-0000-4000-8000-000000000000';
}

function buildShippingMethod(index) {
    var key = 'shipping-method-' + padNum(index, 7);
    return {
        id:              uuidLike('sm', index),
        key:             key,
        version:         1,
        name:            'Shipping ' + index,
        localizedName:   { 'en-US': 'Shipping Method ' + index },
        description:     'Bulk test shipping method ' + index,
        active:          index % 7 !== 0,
        isDefault:       index === 0,
        zoneRates: [{
            zone: { typeId: 'zone', id: 'zone-us' },
            shippingRates: [{
                price: {
                    type:           'centPrecision',
                    currencyCode:   index % 3 === 0 ? 'EUR' : 'USD',
                    centAmount:     499 + (index % 50) * 10,
                    fractionDigits: 2
                }
            }]
        }],
        custom: {
            type: { typeId: 'type', id: 'shipping-custom-type' },
            fields: {
                carrierCode:   'CARRIER-' + (index % 12),
                localizedNote: { en: 'Note for ' + key }
            }
        }
    };
}

function shippingMethodsBatch(offset, count) {
    var out = [];
    var i;
    for (i = 0; i < count; i++) {
        out.push(buildShippingMethod(offset + i));
    }
    return out;
}

function shippingMethods(count) {
    var n = count || targetCount('shipping');
    return shippingMethodsBatch(0, n);
}

function buildInventoryChannels(channelCount) {
    var channels = [];
    var ci;
    for (ci = 0; ci < channelCount; ci++) {
        channels.push({
            id:    uuidLike('inv-ch', ci),
            key:   'supply-channel-' + ci,
            roles: ['InventorySupply'],
            name:  { 'en-US': 'Supply Channel ' + ci }
        });
    }
    return channels;
}

function buildInventoryEntry(index, channels) {
    var ch = channels[index % channels.length];
    return {
        id:                uuidLike('inv', index),
        sku:               'SKU-BULK-' + padNum(index, 8),
        quantityOnStock:   10 + (index % 100),
        availableQuantity: 8 + (index % 80),
        lastModifiedAt:    '2026-06-01T12:00:00.000Z',
        supplyChannel:     { typeId: 'channel', id: ch.id },
        expectedDelivery:  index % 50 === 0 ? '2026-09-01' : null,
        restockableInDays: index % 50 === 0 ? 14 : null
    };
}

function inventoryEntriesBatch(offset, count, channels) {
    var out = [];
    var i;
    for (i = 0; i < count; i++) {
        out.push(buildInventoryEntry(offset + i, channels));
    }
    return out;
}

function inventoryEntries(count, channelCount) {
    var n       = count || targetCount('inventory');
    var chCount = channelCount || targetCount('inventoryChannels');
    var channels = buildInventoryChannels(chCount);
    return {
        entries:  inventoryEntriesBatch(0, n, channels),
        channels: channels
    };
}

function buildPricebookChannels(channelCount) {
    var channels = [];
    var ci;
    for (ci = 0; ci < channelCount; ci++) {
        channels.push({
            id:    uuidLike('pb-ch', ci),
            key:   'dist-channel-' + ci,
            roles: ['ProductDistribution']
        });
    }
    return channels;
}

function buildStandalonePrice(index, channels) {
    var chCount    = channels.length;
    var useChannel = index % 5 !== 0;
    var ch         = channels[index % chCount];
    return {
        id:  uuidLike('price', index),
        sku: 'SKU-BULK-' + padNum(index, 8),
        value: {
            type:           'centPrecision',
            currencyCode:   index % 4 === 0 ? 'EUR' : 'USD',
            centAmount:     999 + (index % 200) * 5,
            fractionDigits: 2
        },
        channel: useChannel ? { typeId: 'channel', id: ch.id } : undefined
    };
}

function standalonePricesBatch(offset, count, channels) {
    var out = [];
    var i;
    for (i = 0; i < count; i++) {
        out.push(buildStandalonePrice(offset + i, channels));
    }
    return out;
}

function standalonePrices(count, channelCount) {
    var n        = count || targetCount('standalonePrices');
    var chCount  = channelCount || targetCount('pricebookChannels');
    var channels = buildPricebookChannels(chCount);
    return {
        prices:   standalonePricesBatch(0, n, channels),
        channels: channels
    };
}

function buildProductWithEmbeddedPrices(index, variantsPerProduct) {
    var vCount    = variantsPerProduct || 2;
    var masterSku = 'PROD-' + padNum(index, 7) + '-M';
    var variants  = [];
    var vi;

    for (vi = 0; vi < vCount - 1; vi++) {
        variants.push({
            sku:    'PROD-' + padNum(index, 7) + '-V' + vi,
            prices: [{
                value: {
                    currencyCode:   'USD',
                    centAmount:     1299 + vi * 100 + (index % 1000),
                    fractionDigits: 2
                }
            }]
        });
    }

    return {
        id:  uuidLike('prod', index),
        key: 'product-' + padNum(index, 7),
        masterData: {
            current: {
                name: { 'en-US': 'Bulk Product ' + index },
                masterVariant: {
                    sku: masterSku,
                    prices: [{
                        value: {
                            currencyCode:   'USD',
                            centAmount:     999 + (index % 10000),
                            fractionDigits: 2
                        },
                        channel: index % 3 === 0
                            ? { typeId: 'channel', id: uuidLike('emb-ch', index % 3) }
                            : undefined
                    }]
                },
                variants: variants
            }
        }
    };
}

function productsWithEmbeddedPricesBatch(offset, count, variantsPerProduct) {
    var out = [];
    var i;
    for (i = 0; i < count; i++) {
        out.push(buildProductWithEmbeddedPrices(offset + i, variantsPerProduct));
    }
    return out;
}

function productsWithEmbeddedPrices(productCount, variantsPerProduct) {
    var pCount = productCount || targetCount('embeddedProducts');
    return productsWithEmbeddedPricesBatch(0, pCount, variantsPerProduct);
}

function buildTaxCategory(index, ratesPerCategory) {
    var rateCount = ratesPerCategory || targetCount('taxRatesPerCategory');
    var countries = ['US', 'DE', 'FR', 'GB', 'CA', 'AU', 'IT', 'ES', 'NL', 'JP'];
    var key       = index === 0 ? 'standard' : 'tax-cat-' + padNum(index, 4);
    var rates     = [];
    var ri;

    for (ri = 0; ri < rateCount; ri++) {
        var country = countries[ri % countries.length];
        var state   = country === 'US' ? ['CA', 'NY', 'TX', 'FL', 'WA'][ri % 5] : '';
        rates.push({
            name:    country + (state ? '-' + state : ''),
            country: country,
            state:   state,
            amount:  0.05 + (ri % 10) * 0.01
        });
    }

    return {
        id:          uuidLike('tax', index),
        key:         key,
        name:        { 'en-US': 'Tax Category ' + key },
        description: 'Bulk tax category ' + index,
        rates:       rates
    };
}

function taxCategoriesBatch(offset, count, ratesPerCategory) {
    var out = [];
    var i;
    for (i = 0; i < count; i++) {
        out.push(buildTaxCategory(offset + i, ratesPerCategory));
    }
    return out;
}

function taxCategories(categoryCount, ratesPerCategory) {
    var catCount = categoryCount || targetCount('taxCategories');
    var rates    = ratesPerCategory || targetCount('taxRatesPerCategory');
    return taxCategoriesBatch(0, catCount, rates);
}

function buildStoreChannels(channelCount) {
    var channels = [];
    var ci;
    for (ci = 0; ci < channelCount; ci++) {
        channels.push({
            id:    uuidLike('store-ch', ci),
            key:   'store-channel-' + padNum(ci, 5),
            roles: ['InventorySupply', 'ProductDistribution'],
            address: {
                streetNumber: String(100 + ci),
                streetName:   'Bulk Test Ave',
                city:         'City-' + ci,
                postalCode:   padNum(10000 + ci, 5),
                state:        ci % 2 === 0 ? 'CA' : 'NY',
                country:      'US',
                email:        'store' + ci + '@bulk-test.example',
                phone:        '+1-555-' + padNum(1000 + ci, 4)
            },
            geoLocation: {
                type:        'Point',
                coordinates: [-118.0 + ci * 0.01, 34.0 + ci * 0.01]
            }
        });
    }
    return channels;
}

function buildStore(index, channels) {
    var ch = channels[index % channels.length];
    return {
        id:                   uuidLike('store', index),
        key:                  'store-' + padNum(index, 7),
        name:                 { 'en-US': 'Bulk Store ' + index },
        countries:            ['US'],
        supplyChannels:       [{ typeId: 'channel', id: ch.id }],
        distributionChannels: []
    };
}

function storesBatch(offset, count, channels) {
    var out = [];
    var i;
    for (i = 0; i < count; i++) {
        out.push(buildStore(offset + i, channels));
    }
    return out;
}

function stores(storeCount, channelCount) {
    var sCount  = storeCount || targetCount('stores');
    var chCount = channelCount || targetCount('storeChannels');
    var channels = buildStoreChannels(chCount);
    return {
        stores:   storesBatch(0, sCount, channels),
        channels: channels
    };
}

function channelMapFromList(channels) {
    var map = {};
    var i;
    for (i = 0; i < channels.length; i++) {
        map[channels[i].id] = channels[i];
    }
    return map;
}

module.exports = {
    SCALES:                          SCALES,
    getScaleName:                    getScaleName,
    getScale:                        getScale,
    targetCount:                     targetCount,
    bulkSize:                        bulkSize,
    buildInventoryChannels:          buildInventoryChannels,
    buildPricebookChannels:          buildPricebookChannels,
    buildStoreChannels:                buildStoreChannels,
    shippingMethods:                 shippingMethods,
    shippingMethodsBatch:            shippingMethodsBatch,
    inventoryEntries:                inventoryEntries,
    inventoryEntriesBatch:           inventoryEntriesBatch,
    standalonePrices:                standalonePrices,
    standalonePricesBatch:           standalonePricesBatch,
    productsWithEmbeddedPrices:      productsWithEmbeddedPrices,
    productsWithEmbeddedPricesBatch: productsWithEmbeddedPricesBatch,
    taxCategories:                   taxCategories,
    taxCategoriesBatch:              taxCategoriesBatch,
    stores:                          stores,
    storesBatch:                     storesBatch,
    channelMapFromList:              channelMapFromList
};
