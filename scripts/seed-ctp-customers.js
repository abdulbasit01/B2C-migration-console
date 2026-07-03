#!/usr/bin/env node
'use strict';

/**
 * Seed commercetools with bulk customers for load testing the customer migration module.
 *
 * Creates customers via POST /customers (standard customer sign-up draft).
 * Each customer gets one shipping/billing address so the address-migration
 * phase of the customer module has something to exercise too.
 *
 * Usage:
 *   node scripts/seed-ctp-customers.js [count]
 *   node scripts/seed-ctp-customers.js 5000
 *   node scripts/seed-ctp-customers.js 100 --dry-run
 *   node scripts/seed-ctp-customers.js 5000 --offset 1000
 *
 * npm run seed:ctp-customers
 */

var ctp = require('./lib/ctp-client');

var CUSTOMER_NUMBER_PREFIX = 'BULK-CUST-';
var EMAIL_DOMAIN     = 'migration-test.local';
var DEFAULT_PASSWORD = 'Rc1!TempPass2024';
var DEFAULT_COUNT    = 5000;
var CONCURRENCY      = 8;
var DEFAULT_COUNTRY  = 'AU';

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

function buildAddress(index) {
    return {
        firstName:  'Bulk',
        lastName:   'Customer ' + index,
        streetName: '123 Migration Street',
        city:       'Sydney',
        postalCode: '2000',
        country:    DEFAULT_COUNTRY
    };
}

function buildCustomerRecord(index) {
    var customerNumber = CUSTOMER_NUMBER_PREFIX + padNum(index, 7);
    var email          = 'bulk-customer-' + padNum(index, 7) + '@' + EMAIL_DOMAIN;

    return {
        index:          index,
        email:          email,
        customerNumber: customerNumber,
        customerDraft: {
            email:                  email,
            password:               DEFAULT_PASSWORD,
            firstName:              'Bulk',
            lastName:               'Customer ' + index,
            customerNumber:         customerNumber,
            addresses:              [buildAddress(index)],
            defaultShippingAddress: 0,
            defaultBillingAddress:  0
        }
    };
}

function customerExists(config, token, email) {
    var where = 'email="' + escWhere(email) + '"';
    var qs    = '?where=' + encodeURIComponent(where) + '&limit=1';
    return ctp.api(config, token, 'GET', ctp.projectPath(config, '/customers') + qs).then(function (res) {
        return res.status === 200 && res.data.results && res.data.results.length > 0;
    });
}

function createCustomer(config, token, record) {
    return ctp.api(config, token, 'POST', ctp.projectPath(config, '/customers'), record.customerDraft)
        .then(function (res) {
            if (res.status === 201 || res.status === 200) {
                return { ok: true };
            }
            if (isDuplicate(res)) {
                return { ok: true, skipped: true };
            }
            return { ok: false, error: ctpError(res) };
        });
}

function seedCustomer(config, token, record) {
    return customerExists(config, token, record.email).then(function (exists) {
        if (exists) {
            return { ok: true, skipped: true };
        }
        return createCustomer(config, token, record);
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

    console.log('CTP customer seed');
    console.log('  project   : ' + cfg.projectKey);
    console.log('  count     : ' + args.count + ' (offset ' + args.offset + ')');
    console.log('  customers : ' + CUSTOMER_NUMBER_PREFIX + padNum(args.offset, 7) + ' …');

    if (args.dryRun) {
        console.log('Dry run — no API calls made.');
        return Promise.resolve();
    }

    var startTime = Date.now();

    return ctp.getToken(cfg)
        .then(function (token) {
            var records = [];
            var i;
            for (i = 0; i < args.count; i++) {
                records.push(buildCustomerRecord(args.offset + i));
            }

            console.log('Seeding ' + records.length + ' customers (concurrency ' + CONCURRENCY + ')…');

            var done = 0;
            var lastLog = 0;

            return runPool(records, function (record) {
                return seedCustomer(cfg, token, record).then(function (result) {
                    result.index = record.index;
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
            console.log('Next: BM → Data Wizard → Customers, or the Customer Migration page.');
            console.log('Customers use numbers like ' + CUSTOMER_NUMBER_PREFIX + padNum(args.offset, 7) + '.');

            if (summary.failed > 0) {
                process.exit(1);
            }
        });
}

main().catch(function (err) {
    console.error('ERROR: ' + (err.message || String(err)));
    process.exit(1);
});
