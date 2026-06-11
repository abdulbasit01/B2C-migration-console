/**
 * Compiles bm_accelerator BM UI styles into static/ (gitignored deploy output).
 *
 * Source (committed): cartridges/bm_accelerator/cartridge/client/default/scss/accelerator-migration.scss
 * Output (generated): cartridges/bm_accelerator/cartridge/static/default/css/accelerator-migration.css
 *
 * Run: npm run compile:scss
 */

'use strict';

const fs = require('fs');
const path = require('path');
const sass = require('sass');

const ROOT = path.resolve(__dirname, '..');
const SCSS = path.join(
    ROOT,
    'cartridges/bm_accelerator/cartridge/client/default/scss/accelerator-migration.scss'
);
const OUT_DIR = path.join(ROOT, 'cartridges/bm_accelerator/cartridge/static/default/css');
const OUT_FILE = path.join(OUT_DIR, 'accelerator-migration.css');

if (!fs.existsSync(SCSS)) {
    console.error('ERROR: SCSS source not found:', SCSS);
    process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const result = sass.compile(SCSS, { style: 'expanded' });
fs.writeFileSync(OUT_FILE, result.css);
console.log('Compiled accelerator-migration.css →', OUT_FILE);
