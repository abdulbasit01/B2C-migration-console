'use strict';

/**
 * Thin wrapper around `@salesforce/b2c-cli cap` so npm scripts work on Windows.
 *
 *   node scripts/cap-cli.js validate
 *   node scripts/cap-cli.js package
 *   node scripts/cap-cli.js install [siteId]
 *   node scripts/cap-cli.js uninstall [siteId]
 *   node scripts/cap-cli.js list [--local]
 */

var path = require('path');
var { spawnSync } = require('child_process');

var ROOT = path.join(__dirname, '..');
var CAP_DIR = path.join(ROOT, 'commerce-rc-b2c-migration-console-app');
var DIST_DIR = path.join(ROOT, 'dist');
var APP_ID = 'rc-b2c-migration-console';
var VERSION = '1.0.0';
var ZIP_NAME = APP_ID + '-v' + VERSION + '.zip';

function run(args) {
    var result = spawnSync('npx', ['--yes', '@salesforce/b2c-cli'].concat(args), {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true
    });
    if (result.status) {
        process.exit(result.status);
    }
}

function siteId(fallbackIndex) {
    var fromArg = process.argv[fallbackIndex];
    var fromEnv = process.env.CAP_SITE_ID || process.env.SFCC_SITE_ID;
    var id = fromArg || fromEnv;
    if (!id || id.indexOf('-') === 0) {
        process.stderr.write('Site id required. Pass an argument or set CAP_SITE_ID.\n');
        process.exit(1);
    }
    return id;
}

var cmd = process.argv[2] || 'validate';

if (cmd === 'validate') {
    run(['cap', 'validate', CAP_DIR]);
} else if (cmd === 'package') {
    run(['cap', 'package', CAP_DIR, '--output', DIST_DIR]);
} else if (cmd === 'install') {
    var zip = path.join(DIST_DIR, ZIP_NAME);
    var target = require('fs').existsSync(zip) ? zip : CAP_DIR;
    run(['cap', 'install', target, '--site-id', siteId(3)]);
} else if (cmd === 'uninstall') {
    run(['cap', 'uninstall', APP_ID, '--site-id', siteId(3)]);
} else if (cmd === 'list') {
    var extra = process.argv.slice(3);
    if (extra.indexOf('--local') !== -1) {
        run(['cap', 'list', '--local']);
    } else {
        run(['cap', 'list', '--site-id', siteId(3)].concat(extra.filter(function (a) {
            return a !== '--local';
        })));
    }
} else {
    process.stderr.write('Unknown command: ' + cmd + '\n');
    process.exit(1);
}
