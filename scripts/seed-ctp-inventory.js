#!/usr/bin/env node
'use strict';

/**
 * Seed commercetools with bulk inventory entries for migration module testing.
 *
 * Creates (if missing):
 *   - Supply channel: bulk-migration-supply
 *   - Products with SKUs: SKU-BULK-00000001 …
 *   - Inventory entries per SKU on that channel
 *
 * Usage:
 *   node scripts/seed-ctp-inventory.js [count]
 *   node scripts/seed-ctp-inventory.js 5000
 *   node scripts/seed-ctp-inventory.js 5000 --dry-run
 *   node scripts/seed-ctp-inventory.js 100 --offset 5000
 *
 * npm run seed:ctp-inventory
 */

var ctp = require('./lib/ctp-client');

var CHANNEL_KEY     = 'bulk-migration-supply';
var SKU_PREFIX      = 'SKU-BULK-';
var PRODUCT_PREFIX  = 'bulk-seed-product-';
var INVENTORY_PREFIX = 'bulk-inv-';
var DEFAULT_COUNT   = 5000;
var CONCURRENCY     = 6;

function padNum(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
}

function parseArgs(argv) {
    var count   = DEFAULT_COUNT;
    var offset  = 0;
    var dryRun  = false;

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

function ensureSupplyChannel(config, token) {
    var path = ctp.projectPath(config, '/channels/key=' + encodeURIComponent(CHANNEL_KEY));
    return ctp.api(config, token, 'GET', path).then(function (res) {
        if (res.status === 200 && res.data && res.data.id) {
            return res.data;
        }
        return ctp.api(config, token, 'POST', ctp.projectPath(config, '/channels'), {
            key:   CHANNEL_KEY,
            roles: ['InventorySupply'],
            name:  { 'en-US': 'Bulk Migration Supply Channel' }
        }).then(function (createRes) {
            if (createRes.status === 201 || createRes.status === 200) {
                return createRes.data;
            }
            if (isDuplicate(createRes)) {
                return ctp.api(config, token, 'GET', path).then(function (retry) {
                    if (retry.status === 200) return retry.data;
                    throw new Error('Channel exists but could not be loaded: ' + ctpError(retry));
                });
            }
            throw new Error('Failed to create supply channel: ' + ctpError(createRes));
        });
    });
}

function getProductType(config, token) {
    return ctp.api(config, token, 'GET', ctp.projectPath(config, '/product-types?limit=1')).then(function (res) {
        if (res.status !== 200 || !res.data.results || !res.data.results.length) {
            throw new Error('No product types found in CTP project. Create at least one product type first.');
        }
        return res.data.results[0];
    });
}

function buildRecords(index, channelId) {
    var sku         = SKU_PREFIX + padNum(index, 8);
    var productKey  = PRODUCT_PREFIX + padNum(index, 7);
    var inventoryKey = INVENTORY_PREFIX + padNum(index, 7);
    var qtyOnStock  = 10 + (index % 100);
    var qtyAvail    = 8 + (index % 80);

    return {
        index:        index,
        sku:          sku,
        productKey:   productKey,
        inventoryKey: inventoryKey,
        channelId:    channelId,
        productDraft: {
            productType: {
                typeId: 'product-type',
                id:     null
            },
            key:  productKey,
            name: { 'en-US': 'Bulk Seed Product ' + index },
            slug: { 'en-US': productKey },
            masterVariant: {
                sku:    sku,
                prices: [{
                    value: {
                        currencyCode:   'USD',
                        centAmount:     100 + (index % 1000),
                        fractionDigits: 2
                    }
                }]
            },
            publish: true
        },
        inventoryDraft: {
            key:               inventoryKey,
            sku:               sku,
            quantityOnStock:   qtyOnStock,
            availableQuantity: qtyAvail,
            supplyChannel:     {
                typeId: 'channel',
                id:     channelId
            }
        }
    };
}

function createProduct(config, token, record) {
    var draft = Object.assign({}, record.productDraft);
    draft.productType = {
        typeId: 'product-type',
        id:     draft.productType.id
    };

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

function createInventory(config, token, record) {
    return ctp.api(config, token, 'POST', ctp.projectPath(config, '/inventory'), record.inventoryDraft).then(function (res) {
        if (res.status === 201 || res.status === 200) {
            return { ok: true, skipped: false };
        }
        if (isDuplicate(res)) {
            return { ok: true, skipped: true };
        }
        return { ok: false, error: ctpError(res) };
    });
}

function processRecord(config, token, productTypeId, record) {
    record.productDraft.productType.id = productTypeId;

    return createProduct(config, token, record).then(function (productResult) {
        if (!productResult.ok) {
            return { index: record.index, ok: false, stage: 'product', error: productResult.error };
        }
        return createInventory(config, token, record).then(function (invResult) {
            if (!invResult.ok) {
                return { index: record.index, ok: false, stage: 'inventory', error: invResult.error };
            }
            return {
                index:   record.index,
                ok:      true,
                sku:     record.sku,
                skipped: productResult.skipped && invResult.skipped
            };
        });
    });
}

function runPool(items, worker, concurrency) {
    var results  = new Array(items.length);
    var nextIdx  = 0;
    var active   = 0;
    var finished = 0;

    return new Promise(function (resolve, reject) {
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

    console.log('CTP inventory seed');
    console.log('  project : ' + cfg.projectKey);
    console.log('  channel : ' + CHANNEL_KEY);
    console.log('  count   : ' + args.count + ' (offset ' + args.offset + ')');
    console.log('  SKUs    : ' + SKU_PREFIX + padNum(args.offset, 8) + ' …');

    if (args.dryRun) {
        console.log('Dry run — no API calls made.');
        return Promise.resolve();
    }

    var token;
    var channel;
    var productType;
    var startTime = Date.now();

    return ctp.getToken(cfg)
        .then(function (t) {
            token = t;
            return ensureSupplyChannel(cfg, token);
        })
        .then(function (ch) {
            channel = ch;
            console.log('  supply channel id: ' + channel.id);
            return getProductType(cfg, token);
        })
        .then(function (pt) {
            productType = pt;
            console.log('  product type    : ' + (pt.key || pt.id));
            console.log('Seeding ' + args.count + ' inventory entries (concurrency ' + CONCURRENCY + ')…');

            var records = [];
            var i;
            for (i = 0; i < args.count; i++) {
                records.push(buildRecords(args.offset + i, channel.id));
            }

            var done = 0;
            var lastLog = 0;

            return runPool(records, function (record) {
                return processRecord(cfg, token, productType.id, record).then(function (result) {
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
            console.log('Next: open BM → Data Wizard → Inventory → reload channels/count.');
            console.log('Filter by supply channel "' + CHANNEL_KEY + '" or use aggregated export.');

            if (summary.failed > 0) {
                process.exit(1);
            }
        });
}

main().catch(function (err) {
    console.error('ERROR: ' + (err.message || String(err)));
    process.exit(1);
});
