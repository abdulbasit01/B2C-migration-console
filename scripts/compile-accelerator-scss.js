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
const INV_MIGRATION_SRC = path.join(CARTRIDGE, 'client/default/js/inventory-migration.js');
const PB_MIGRATION_SRC = path.join(CARTRIDGE, 'client/default/js/pricebook-migration.js');
const TX_MIGRATION_SRC = path.join(CARTRIDGE, 'client/default/js/tax-migration.js');
const ST_MIGRATION_SRC = path.join(CARTRIDGE, 'client/default/js/store-migration.js');
const ORD_MIGRATION_SRC = path.join(CARTRIDGE, 'client/default/js/order-migration.js');
const CAT_MIGRATION_SRC = path.join(CARTRIDGE, 'client/default/js/categoryMigration.js');
const CMS_MIGRATION_SRC = path.join(CARTRIDGE, 'client/default/js/content-migration.js');
const CMS_SCHEMA_MIGRATION_SRC = path.join(CARTRIDGE, 'client/default/js/content-schema-migration.js');
const AMPLIENCE_LOGO_SRC = path.join(CARTRIDGE, 'client/default/images/amplience-logo.png');
const CSS_OUT_DIR = path.join(CARTRIDGE, 'static/default/css');
const CSS_OUT_FILE = path.join(CSS_OUT_DIR, 'accelerator-migration.css');
const JS_OUT_DIR = path.join(CARTRIDGE, 'static/default/js');
const JS_OUT_FILE = path.join(JS_OUT_DIR, 'data-wizard.js');
const ATTR_PREFLIGHT_SRC = path.join(CARTRIDGE, 'client/default/js/attr-preflight.js');
const ATTR_PREFLIGHT_OUT = path.join(JS_OUT_DIR, 'attr-preflight.js');
const INV_MIGRATION_OUT = path.join(JS_OUT_DIR, 'inventory-migration.js');
const PB_MIGRATION_OUT = path.join(JS_OUT_DIR, 'pricebook-migration.js');
const TX_MIGRATION_OUT = path.join(JS_OUT_DIR, 'tax-migration.js');
const ST_MIGRATION_OUT = path.join(JS_OUT_DIR, 'store-migration.js');
const ORD_MIGRATION_OUT = path.join(JS_OUT_DIR, 'order-migration.js');
const CAT_MIGRATION_OUT = path.join(JS_OUT_DIR, 'categoryMigration.js');
const CMS_MIGRATION_OUT = path.join(JS_OUT_DIR, 'content-migration.js');
const CMS_SCHEMA_MIGRATION_OUT = path.join(JS_OUT_DIR, 'content-schema-migration.js');
const IMAGES_OUT_DIR = path.join(CARTRIDGE, 'static/default/images');
const AMPLIENCE_LOGO_OUT = path.join(IMAGES_OUT_DIR, 'amplience-logo.png');

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
if (fs.existsSync(ATTR_PREFLIGHT_SRC)) {
    fs.mkdirSync(JS_OUT_DIR, { recursive: true });
    fs.copyFileSync(ATTR_PREFLIGHT_SRC, ATTR_PREFLIGHT_OUT);
    console.log('Copied attr-preflight.js →', ATTR_PREFLIGHT_OUT);
}
if (fs.existsSync(INV_MIGRATION_SRC)) {
    fs.mkdirSync(JS_OUT_DIR, { recursive: true });
    fs.copyFileSync(INV_MIGRATION_SRC, INV_MIGRATION_OUT);
    console.log('Copied inventory-migration.js →', INV_MIGRATION_OUT);
}
if (fs.existsSync(PB_MIGRATION_SRC)) {
    fs.mkdirSync(JS_OUT_DIR, { recursive: true });
    fs.copyFileSync(PB_MIGRATION_SRC, PB_MIGRATION_OUT);
    console.log('Copied pricebook-migration.js →', PB_MIGRATION_OUT);
}
if (fs.existsSync(TX_MIGRATION_SRC)) {
    fs.mkdirSync(JS_OUT_DIR, { recursive: true });
    fs.copyFileSync(TX_MIGRATION_SRC, TX_MIGRATION_OUT);
    console.log('Copied tax-migration.js →', TX_MIGRATION_OUT);
}
if (fs.existsSync(ST_MIGRATION_SRC)) {
    fs.mkdirSync(JS_OUT_DIR, { recursive: true });
    fs.copyFileSync(ST_MIGRATION_SRC, ST_MIGRATION_OUT);
    console.log('Copied store-migration.js →', ST_MIGRATION_OUT);
}
if (fs.existsSync(ORD_MIGRATION_SRC)) {
    fs.mkdirSync(JS_OUT_DIR, { recursive: true });
    fs.copyFileSync(ORD_MIGRATION_SRC, ORD_MIGRATION_OUT);
    console.log('Copied order-migration.js →', ORD_MIGRATION_OUT);
}
if (fs.existsSync(CAT_MIGRATION_SRC)) {
    fs.mkdirSync(JS_OUT_DIR, { recursive: true });
    fs.copyFileSync(CAT_MIGRATION_SRC, CAT_MIGRATION_OUT);
    console.log('Copied categoryMigration.js →', CAT_MIGRATION_OUT);
}
if (fs.existsSync(CMS_MIGRATION_SRC)) {
    fs.mkdirSync(JS_OUT_DIR, { recursive: true });
    fs.copyFileSync(CMS_MIGRATION_SRC, CMS_MIGRATION_OUT);
    console.log('Copied content-migration.js →', CMS_MIGRATION_OUT);
}
if (fs.existsSync(CMS_SCHEMA_MIGRATION_SRC)) {
    fs.mkdirSync(JS_OUT_DIR, { recursive: true });
    fs.copyFileSync(CMS_SCHEMA_MIGRATION_SRC, CMS_SCHEMA_MIGRATION_OUT);
    console.log('Copied content-schema-migration.js →', CMS_SCHEMA_MIGRATION_OUT);
}
if (fs.existsSync(AMPLIENCE_LOGO_SRC)) {
    fs.mkdirSync(IMAGES_OUT_DIR, { recursive: true });
    fs.copyFileSync(AMPLIENCE_LOGO_SRC, AMPLIENCE_LOGO_OUT);
    console.log('Copied amplience-logo.png →', AMPLIENCE_LOGO_OUT);
}
