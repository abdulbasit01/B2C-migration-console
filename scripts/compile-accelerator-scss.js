/**
 * Compiles bm_accelerator BM UI assets into static/ (gitignored deploy output).
 *
 * Source (committed):
 *   client/default/scss/accelerator-migration.scss
 *   client/default/js/data-wizard.js
 * Output (generated):
 *   static/default/css/accelerator-migration.css
 *   static/default/js/data-wizard.js
 *
 * Run: npm run compile:scss
 */

'use strict';

const fs = require('fs');
const path = require('path');
const sass = require('sass');

const ROOT = path.resolve(__dirname, '..');
const CARTRIDGE = path.join(ROOT, 'cartridges/bm_accelerator/cartridge');
const SCSS = path.join(CARTRIDGE, 'client/default/scss/accelerator-migration.scss');
const JS_SRC = path.join(CARTRIDGE, 'client/default/js/data-wizard.js');
const CSS_OUT_DIR = path.join(CARTRIDGE, 'static/default/css');
const CSS_OUT_FILE = path.join(CSS_OUT_DIR, 'accelerator-migration.css');
const JS_OUT_DIR = path.join(CARTRIDGE, 'static/default/js');
const JS_OUT_FILE = path.join(JS_OUT_DIR, 'data-wizard.js');

if (!fs.existsSync(SCSS)) {
    console.error('ERROR: SCSS source not found:', SCSS);
    process.exit(1);
}

fs.mkdirSync(CSS_OUT_DIR, { recursive: true });

const result = sass.compile(SCSS, { style: 'expanded' });
fs.writeFileSync(CSS_OUT_FILE, result.css);
console.log('Compiled accelerator-migration.css →', CSS_OUT_FILE);

if (fs.existsSync(JS_SRC)) {
    fs.mkdirSync(JS_OUT_DIR, { recursive: true });
    fs.copyFileSync(JS_SRC, JS_OUT_FILE);
    console.log('Copied data-wizard.js →', JS_OUT_FILE);
}
