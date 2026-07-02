'use strict';

var ctp = require('./ctp-client');

var SUPPLY_CHANNEL_KEY = 'bulk-migration-supply';
var PAGE_SIZE          = 500;

function escWhere(val) {
    return String(val || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function readProductSku(product) {
    if (!product) return '';
    if (product.masterVariant && product.masterVariant.sku) {
        return product.masterVariant.sku;
    }
    var current = product.masterData && product.masterData.current;
    if (current && current.masterVariant && current.masterVariant.sku) {
        return current.masterVariant.sku;
    }
    return '';
}

function readVariantSkus(product) {
    var skus = [];
    var master = readProductSku(product);
    if (master) skus.push(master);

    var variants = (product.masterData && product.masterData.current && product.masterData.current.variants)
        || product.variants
        || [];
    var j;
    for (j = 0; j < variants.length; j++) {
        if (variants[j].sku) {
            skus.push(variants[j].sku);
        }
    }
    return skus;
}

function fetchSupplyChannelId(config, token) {
    var path = ctp.projectPath(config, '/channels/key=' + encodeURIComponent(SUPPLY_CHANNEL_KEY));
    return ctp.api(config, token, 'GET', path).then(function (res) {
        if (res.status === 200 && res.data && res.data.id) {
            return res.data.id;
        }
        return null;
    });
}

function fetchSkusFromInventory(config, token, count, offset, channelId) {
    if (!channelId) {
        return Promise.resolve([]);
    }

    var skus       = [];
    var pageOffset = offset;

    function nextPage() {
        if (skus.length >= count) {
            return Promise.resolve(skus.slice(0, count));
        }

        var where = 'supplyChannel(id="' + escWhere(channelId) + '")';
        var qs    = '?where=' + encodeURIComponent(where)
            + '&limit=' + PAGE_SIZE
            + '&offset=' + pageOffset
            + '&sort=id asc';

        return ctp.api(config, token, 'GET', ctp.projectPath(config, '/inventory') + qs).then(function (res) {
            if (res.status !== 200) {
                return [];
            }
            var rows = res.data.results || [];
            var i;
            for (i = 0; i < rows.length; i++) {
                if (rows[i].sku) {
                    skus.push(rows[i].sku);
                }
                if (skus.length >= count) {
                    break;
                }
            }
            if (!rows.length || skus.length >= count) {
                return skus.slice(0, count);
            }
            pageOffset += rows.length;
            return nextPage();
        });
    }

    return nextPage();
}

function fetchSkusFromProducts(config, token, count, offset) {
    var skus       = [];
    var pageOffset = offset;

    function nextPage() {
        if (skus.length >= count) {
            return Promise.resolve(skus.slice(0, count));
        }

        var qs = '?limit=' + PAGE_SIZE
            + '&offset=' + pageOffset
            + '&sort=id asc'
            + '&withTotal=true';

        return ctp.api(config, token, 'GET', ctp.projectPath(config, '/products') + qs).then(function (res) {
            if (res.status !== 200) {
                throw new Error('Product fetch failed');
            }
            var rows = res.data.results || [];
            var i;
            for (i = 0; i < rows.length; i++) {
                var productSkus = readVariantSkus(rows[i]);
                var k;
                for (k = 0; k < productSkus.length; k++) {
                    skus.push(productSkus[k]);
                    if (skus.length >= count) {
                        break;
                    }
                }
                if (skus.length >= count) {
                    break;
                }
            }
            if (!rows.length || skus.length >= count) {
                return skus.slice(0, count);
            }
            pageOffset += rows.length;
            return nextPage();
        });
    }

    return nextPage();
}

/**
 * Resolve SKUs for seed scripts (inventory channel first, then products).
 * @returns {Promise<{ skus: string[], source: string }>}
 */
function resolveSkus(config, token, count, offset) {
    return fetchSupplyChannelId(config, token).then(function (channelId) {
        return fetchSkusFromInventory(config, token, count, offset, channelId).then(function (fromInv) {
            if (fromInv.length >= count) {
                return { skus: fromInv, source: 'inventory (' + SUPPLY_CHANNEL_KEY + ')' };
            }
            return fetchSkusFromProducts(config, token, count, offset).then(function (fromProducts) {
                if (!fromProducts.length && !fromInv.length) {
                    throw new Error(
                        'No product SKUs found. Run npm run seed:ctp-inventory first, '
                        + 'or create products with SKUs in commercetools.'
                    );
                }
                var merged = fromInv.concat(fromProducts);
                var seen   = {};
                var unique = [];
                var i;
                for (i = 0; i < merged.length; i++) {
                    if (!seen[merged[i]]) {
                        seen[merged[i]] = true;
                        unique.push(merged[i]);
                    }
                    if (unique.length >= count) {
                        break;
                    }
                }
                var source = fromInv.length ? 'inventory + products' : 'products';
                return { skus: unique.slice(0, count), source: source };
            });
        });
    });
}

module.exports = {
    SUPPLY_CHANNEL_KEY: SUPPLY_CHANNEL_KEY,
    resolveSkus:        resolveSkus
};
