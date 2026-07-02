#!/usr/bin/env node
'use strict';

/**
 * Seed commercetools with standalone prices for the pricebook migration module.
 *
 * Attaches USD standalone prices (no channel) to existing product SKUs.
 * Prefers SKUs from the bulk-migration-supply inventory channel (inventory seed);
 * falls back to paginated /products when that channel is empty.
 *
 * Creates one aggregated pricebook target: "USD — All channels" in BM.
 *
 * Usage:
 *   node scripts/seed-ctp-standalone-prices.js [count]
 *   node scripts/seed-ctp-standalone-prices.js 500
 *   node scripts/seed-ctp-standalone-prices.js 100 --dry-run
 *   node scripts/seed-ctp-standalone-prices.js 500 --offset 100
 *
 * npm run seed:ctp-standalone-prices
 */

var ctp = require('./lib/ctp-client');

var SUPPLY_CHANNEL_KEY = 'bulk-migration-supply';
var SKU_PREFIX         = 'SKU-BULK-';
var PRODUCT_PREFIX     = 'bulk-seed-product-';
var PRICE_KEY_PREFIX   = 'bulk-standalone-usd-';
var DEFAULT_CURRENCY   = 'USD';
var DEFAULT_COUNT      = 500;
var CONCURRENCY        = 10;
var PAGE_SIZE          = 500;

function padNum(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
}

function parseArgs(argv) {
    var count  = DEFAULT_COUNT;
    var offset = 0;
    var dryRun = false;

    for (var i = 2; i < argv.length; i++) {
        var arg = argv[i];
        if (arg === '--dry-run') {
            dryRun = true;
        } else if (arg === '--offset' && argv[i + 1]) {
            offset = parseInt(argv[++i], 10) || 0;
        } else if (/^\d+$/.test(arg)) {
            count = parseInt(arg, 10);
        }
    }

    if (count < 1) {
        throw new Error('count must be at least 1');
    }

    return { count: count, offset: offset, dryRun: dryRun };
}

function ctpError(res) {
    if (!res.data) return res.text || ('HTTP ' + res.status);
    if (res.data.message) return res.data.message;
    if (res.data.errors && res.data.errors.length) {
        return res.data.errors.map(function (e) { return e.message || JSON.stringify(e); }).join('; ');
    }
    return JSON.stringify(res.data);
}

function isDuplicate(res) {
    if (res.status === 409) return true;
    if (res.data && res.data.errors) {
        for (var i = 0; i < res.data.errors.length; i++) {
            var code = res.data.errors[i].code || '';
            if (code === 'DuplicateField' || code === 'DuplicateAttributeValue') return true;
        }
    }
    return false;
}

function escWhere(val) {
    return String(val || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getProductType(config, token) {
    return ctp.api(config, token, 'GET', ctp.projectPath(config, '/product-types?limit=1')).then(function (res) {
        if (res.status !== 200 || !res.data.results || !res.data.results.length) {
            throw new Error('No product types found in CTP project. Create at least one product type first.');
        }
        return res.data.results[0];
    });
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
                throw new Error('Product fetch failed: ' + ctpError(res));
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
                var source = fromInv.length
                    ? 'inventory + products'
                    : 'products';
                return { skus: unique.slice(0, count), source: source };
            });
        });
    });
}


function buildPriceRecord(index, sku) {
    return {
        index:    index,
        sku:      sku,
        priceKey: PRICE_KEY_PREFIX + padNum(index, 7),
        priceDraft: {
            key: PRICE_KEY_PREFIX + padNum(index, 7),
            sku: sku,
            value: {
                currencyCode:   DEFAULT_CURRENCY,
                centAmount:     500 + (index % 5000),
                fractionDigits: 2
            }
        }
    };
}

function buildProductDraft(index, productTypeId, sku) {
    var productKey = PRODUCT_PREFIX + padNum(index, 7);
    return {
        productType: { typeId: 'product-type', id: productTypeId },
        key:         productKey,
        name:        { 'en-US': 'Bulk Seed Product ' + index },
        slug:        { 'en-US': productKey },
        masterVariant: { sku: sku },
        publish:     true
    };
}

function productExistsBySku(config, token, sku) {
    var where = 'masterVariant(sku="' + escWhere(sku) + '")';
    var qs    = '?where=' + encodeURIComponent(where) + '&limit=1';
    return ctp.api(config, token, 'GET', ctp.projectPath(config, '/products') + qs).then(function (res) {
        return res.status === 200 && res.data.results && res.data.results.length > 0;
    });
}

function createProduct(config, token, draft) {
    return ctp.api(config, token, 'POST', ctp.projectPath(config, '/products'), draft).then(function (res) {
        if (res.status === 201 || res.status === 200) {
            return { ok: true, skipped: false };
        }
        if (isDuplicate(res)) {
            return { ok: true, skipped: true };
        }
        return { ok: false, error: ctpError(res) };
    });
}

function createStandalonePrice(config, token, record) {
    return ctp.api(config, token, 'POST', ctp.projectPath(config, '/standalone-prices'), record.priceDraft).then(function (res) {
        if (res.status === 201 || res.status === 200) {
            return { ok: true, skipped: false };
        }
        if (isDuplicate(res)) {
            return { ok: true, skipped: true };
        }
        return { ok: false, error: ctpError(res) };
    });
}

function ensureProductThenPrice(config, token, productTypeId, record) {
    return productExistsBySku(config, token, record.sku).then(function (exists) {
        if (exists) {
            return createStandalonePrice(config, token, record).then(function (priceResult) {
                if (!priceResult.ok) {
                    return { index: record.index, ok: false, stage: 'standalone-price', error: priceResult.error };
                }
                return {
                    index:   record.index,
                    ok:      true,
                    sku:     record.sku,
                    skipped: priceResult.skipped
                };
            });
        }

        var draft = buildProductDraft(record.index, productTypeId, record.sku);
        return createProduct(config, token, draft).then(function (productResult) {
            if (!productResult.ok) {
                return { index: record.index, ok: false, stage: 'product', error: productResult.error };
            }
            return createStandalonePrice(config, token, record).then(function (priceResult) {
                if (!priceResult.ok) {
                    return { index: record.index, ok: false, stage: 'standalone-price', error: priceResult.error };
                }
                return {
                    index:   record.index,
                    ok:      true,
                    sku:     record.sku,
                    skipped: productResult.skipped && priceResult.skipped
                };
            });
        });
    });
}

function runPool(items, worker, concurrency) {
    var results  = new Array(items.length);
    var nextIdx  = 0;
    var active   = 0;
    var finished = 0;

    return new Promise(function (resolve) {
        function launch() {
            while (active < concurrency && nextIdx < items.length) {
                (function (slot) {
                    var item = items[slot];
                    active++;
                    worker(item).then(function (result) {
                        results[slot] = result;
                    }).catch(function (err) {
                        results[slot] = { index: item.index, ok: false, error: err.message || String(err) };
                    }).then(function () {
                        active--;
                        finished++;
                        if (finished === items.length) {
                            resolve(results);
                            return;
                        }
                        launch();
                    });
                })(nextIdx++);
            }
        }
        if (!items.length) {
            resolve([]);
            return;
        }
        launch();
    });
}

function summarize(results) {
    var created = 0;
    var skipped = 0;
    var failed  = 0;
    var errors  = [];

    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        if (!r || !r.ok) {
            failed++;
            if (errors.length < 10 && r) {
                errors.push('#' + r.index + ' (' + (r.stage || '?') + '): ' + (r.error || 'unknown'));
            }
        } else if (r.skipped) {
            skipped++;
        } else {
            created++;
        }
    }

    return { created: created, skipped: skipped, failed: failed, errors: errors };
}

function main() {
    var args = parseArgs(process.argv);
    var env  = ctp.loadEnv();
    var cfg  = ctp.getCtpConfig(env);

    console.log('CTP standalone pricebook seed');
    console.log('  project  : ' + cfg.projectKey);
    console.log('  currency : ' + DEFAULT_CURRENCY + ' (all channels / aggregated)');
    console.log('  count    : ' + args.count + ' (offset ' + args.offset + ')');

    if (args.dryRun) {
        console.log('Dry run — no API calls made.');
        return Promise.resolve();
    }

    var token;
    var productType;
    var startTime = Date.now();

    return ctp.getToken(cfg)
        .then(function (t) {
            token = t;
            return resolveSkus(cfg, token, args.count, args.offset);
        })
        .then(function (skuResult) {
            console.log('  SKU source: ' + skuResult.source);
            console.log('  first SKU : ' + (skuResult.skus[0] || '(none)'));
            if (skuResult.skus.length < args.count) {
                console.warn('  warning   : only ' + skuResult.skus.length + ' SKUs available (requested ' + args.count + ')');
            }

            var pricesOnly = String(skuResult.source || '').indexOf('inventory') >= 0;
            if (pricesOnly) {
                return {
                    skus:        skuResult.skus,
                    skuSource:   skuResult.source,
                    pricesOnly:  true,
                    productType: null
                };
            }

            return getProductType(cfg, token).then(function (pt) {
                return {
                    skus:        skuResult.skus,
                    skuSource:   skuResult.source,
                    pricesOnly:  false,
                    productType: pt
                };
            });
        })
        .then(function (ctx) {
            productType = ctx.productType;
            console.log('  product type: ' + (productType ? (productType.key || productType.id) : '(skipped — SKUs from inventory)'));
            console.log('Seeding standalone prices (concurrency ' + CONCURRENCY + ')…');

            var records = [];
            var i;
            for (i = 0; i < ctx.skus.length; i++) {
                records.push(buildPriceRecord(args.offset + i, ctx.skus[i]));
            }

            var done = 0;
            var lastLog = 0;

            return runPool(records, function (record) {
                var work = ctx.pricesOnly
                    ? createStandalonePrice(cfg, token, record)
                    : ensureProductThenPrice(cfg, token, productType.id, record);

                return work.then(function (result) {
                    if (ctx.pricesOnly) {
                        if (!result.ok) {
                            result = { index: record.index, ok: false, stage: 'standalone-price', error: result.error };
                        } else {
                            result = {
                                index:   record.index,
                                ok:      true,
                                sku:     record.sku,
                                skipped: result.skipped
                            };
                        }
                    }
                    done++;
                    if (done - lastLog >= 100 || done === records.length) {
                        lastLog = done;
                        var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                        process.stdout.write('\r  progress: ' + done + '/' + records.length + ' (' + elapsed + 's)');
                    }
                    return result;
                });
            }, CONCURRENCY);
        })
        .then(function (results) {
            console.log('');
            var summary = summarize(results);
            var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

            console.log('Done in ' + elapsed + 's');
            console.log('  created : ' + summary.created);
            console.log('  skipped : ' + summary.skipped + ' (already existed)');
            console.log('  failed  : ' + summary.failed);

            if (summary.errors.length) {
                console.log('  errors  :');
                summary.errors.forEach(function (e) { console.log('    - ' + e); });
            }

            console.log('');
            console.log('Next: BM → Pricebook Migration → Load Standalone.');
            console.log('Select the "' + DEFAULT_CURRENCY + ' — All channels" pricebook target and export.');

            if (summary.failed > 0) {
                process.exit(1);
            }
        });
}

main().catch(function (err) {
    console.error('ERROR: ' + (err.message || String(err)));
    process.exit(1);
});
