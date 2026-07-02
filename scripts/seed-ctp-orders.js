#!/usr/bin/env node
'use strict';

/**
 * Seed commercetools with bulk orders for the order migration module.
 *
 * Creates orders via POST /orders/import (falls back to cart → order when needed).
 * Uses SKUs from the bulk-migration-supply inventory channel when available.
 *
 * Usage:
 *   node scripts/seed-ctp-orders.js [count]
 *   node scripts/seed-ctp-orders.js 500
 *   node scripts/seed-ctp-orders.js 100 --dry-run
 *   node scripts/seed-ctp-orders.js 500 --offset 100
 *
 * npm run seed:ctp-orders
 */

var ctp     = require('./lib/ctp-client');
var skuLib  = require('./lib/ctp-seed-skus');

var ORDER_PREFIX   = 'BULK-ORD-';
var EMAIL_DOMAIN   = 'migration-test.local';
var DEFAULT_COUNT  = 500;
var CONCURRENCY    = 4;
var DEFAULT_CUR    = 'USD';
var DEFAULT_COUNTRY = 'AU';

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

function money(centAmount) {
    return {
        type:           'centPrecision',
        currencyCode:   DEFAULT_CUR,
        centAmount:     centAmount,
        fractionDigits: 2
    };
}

function buildAddress(index) {
    return {
        firstName:   'Bulk',
        lastName:    'Customer ' + index,
        streetName:  '123 Migration Street',
        city:        'Sydney',
        postalCode:  '2000',
        country:     DEFAULT_COUNTRY
    };
}

function buildOrderRecord(index, sku) {
    var orderNumber = ORDER_PREFIX + padNum(index, 7);
    var quantity    = 1 + (index % 3);
    var unitCents   = 500 + (index % 5000);
    var totalCents  = unitCents * quantity;

    return {
        index:       index,
        orderNumber: orderNumber,
        sku:         sku,
        importDraft: {
            orderNumber:     orderNumber,
            customerEmail:   'bulk-order-' + padNum(index, 7) + '@' + EMAIL_DOMAIN,
            orderState:      'Confirmed',
            paymentState:    'Paid',
            shipmentState:   'Shipped',
            lineItems:       [{
                name:     { 'en-US': 'Bulk seed product ' + sku },
                quantity: quantity,
                sku:      sku,
                price:    {
                    value: money(unitCents)
                }
            }],
            billingAddress:  buildAddress(index),
            shippingAddress: buildAddress(index),
            totalPrice:      money(totalCents)
        }
    };
}

function orderExists(config, token, orderNumber) {
    var path = ctp.projectPath(config, '/orders/order-number=' + encodeURIComponent(orderNumber));
    return ctp.api(config, token, 'GET', path).then(function (res) {
        return res.status === 200 && res.data && res.data.id;
    });
}

function importOrder(config, token, record) {
    return ctp.api(config, token, 'POST', ctp.projectPath(config, '/orders/import'), record.importDraft)
        .then(function (res) {
            if (res.status === 201 || res.status === 200) {
                return { ok: true, method: 'import' };
            }
            if (isDuplicate(res)) {
                return { ok: true, skipped: true, method: 'import' };
            }
            return { ok: false, error: ctpError(res), method: 'import' };
        });
}

function createCart(config, token) {
    return ctp.api(config, token, 'POST', ctp.projectPath(config, '/carts'), {
        currency: DEFAULT_CUR,
        country:  DEFAULT_COUNTRY,
        taxMode:  'Disabled'
    }).then(function (res) {
        if (res.status !== 201 && res.status !== 200) {
            throw new Error('Cart create failed: ' + ctpError(res));
        }
        return res.data;
    });
}

function updateCart(config, token, cart, record) {
    var addr = buildAddress(record.index);
    return ctp.api(config, token, 'POST', ctp.projectPath(config, '/carts/' + cart.id), {
        version: cart.version,
        actions: [
            {
                action:   'addLineItem',
                sku:      record.sku,
                quantity: record.importDraft.lineItems[0].quantity
            },
            {
                action: 'setCustomerEmail',
                email:  record.importDraft.customerEmail
            },
            {
                action:  'setShippingAddress',
                address: addr
            },
            {
                action:  'setBillingAddress',
                address: addr
            }
        ]
    }).then(function (res) {
        if (res.status !== 200) {
            throw new Error('Cart update failed: ' + ctpError(res));
        }
        return res.data;
    });
}

function createOrderFromCart(config, token, cart, record) {
    return ctp.api(config, token, 'POST', ctp.projectPath(config, '/orders'), {
        cart: {
            typeId: 'cart',
            id:     cart.id
        },
        version:     cart.version,
        orderNumber: record.orderNumber
    }).then(function (res) {
        if (res.status === 201 || res.status === 200) {
            return { ok: true, method: 'cart' };
        }
        if (isDuplicate(res)) {
            return { ok: true, skipped: true, method: 'cart' };
        }
        return { ok: false, error: ctpError(res), method: 'cart' };
    });
}

function createOrderViaCart(config, token, record) {
    var cart;
    return createCart(config, token)
        .then(function (created) {
            cart = created;
            return updateCart(config, token, cart, record);
        })
        .then(function (updated) {
            cart = updated;
            return createOrderFromCart(config, token, cart, record);
        });
}

function createOrder(config, token, record) {
    return orderExists(config, token, record.orderNumber).then(function (exists) {
        if (exists) {
            return { ok: true, skipped: true, method: 'exists' };
        }
        return importOrder(config, token, record).then(function (importResult) {
            if (importResult.ok) {
                return importResult;
            }
            return createOrderViaCart(config, token, record).then(function (cartResult) {
                if (!cartResult.ok) {
                    cartResult.error = (importResult.error || 'import failed')
                        + ' | cart fallback: ' + (cartResult.error || 'failed');
                }
                return cartResult;
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
                        results[slot] = {
                            index: item.index,
                            ok:    false,
                            error: err.message || String(err)
                        };
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
                errors.push('#' + r.index + ': ' + (r.error || 'unknown'));
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

    console.log('CTP order seed');
    console.log('  project : ' + cfg.projectKey);
    console.log('  count   : ' + args.count + ' (offset ' + args.offset + ')');
    console.log('  orders  : ' + ORDER_PREFIX + padNum(args.offset, 7) + ' …');

    if (args.dryRun) {
        console.log('Dry run — no API calls made.');
        return Promise.resolve();
    }

    var token;
    var startTime = Date.now();

    return ctp.getToken(cfg)
        .then(function (t) {
            token = t;
            return skuLib.resolveSkus(cfg, token, args.count, args.offset);
        })
        .then(function (skuResult) {
            console.log('  SKU source: ' + skuResult.source);
            console.log('  first SKU : ' + (skuResult.skus[0] || '(none)'));
            if (skuResult.skus.length < args.count) {
                console.warn('  warning   : only ' + skuResult.skus.length + ' SKUs available (requested ' + args.count + ')');
            }

            var records = [];
            var i;
            for (i = 0; i < skuResult.skus.length; i++) {
                records.push(buildOrderRecord(args.offset + i, skuResult.skus[i]));
            }

            console.log('Seeding ' + records.length + ' orders (concurrency ' + CONCURRENCY + ')…');

            var done = 0;
            var lastLog = 0;

            return runPool(records, function (record) {
                return createOrder(cfg, token, record).then(function (result) {
                    result.index = record.index;
                    done++;
                    if (done - lastLog >= 50 || done === records.length) {
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
            console.log('Next: BM → Data Wizard → Orders (1-year range) or Order Migration.');
            console.log('Orders use numbers like ' + ORDER_PREFIX + padNum(args.offset, 7) + '.');

            if (summary.failed > 0) {
                process.exit(1);
            }
        });
}

main().catch(function (err) {
    console.error('ERROR: ' + (err.message || String(err)));
    process.exit(1);
});
