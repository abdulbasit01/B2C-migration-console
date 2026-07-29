/**
 * Sync packages/amplience-core/src into SFCC helpers.
 * Run from repo root: node scripts/sync-amplience-core-to-sfcc.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'packages/amplience-core/src');
const DEST = path.join(
    ROOT,
    'cartridges/app_custom_cms/cartridge/scripts/helpers/amplienceCore'
);

const FILES = ['cdn.js', 'transform.js', 'fetch.js', 'index.js'];
const HEADER = "'use strict';\n\n/** AUTO-GENERATED from packages/amplience-core — run scripts/sync-amplience-core-to-sfcc.js */\n\n";

function main() {
    fs.mkdirSync(DEST, { recursive: true });

    FILES.forEach((file) => {
        const sourcePath = path.join(SRC, file);
        const raw = fs.readFileSync(sourcePath, 'utf8');
        const body = raw.replace(/^'use strict';\s*/m, '');
        const target = path.join(DEST, file);
        fs.writeFileSync(target, HEADER + body, 'utf8');
        console.log('wrote', target);
    });

    generateEsm();
}

function generateEsm() {
    const esmDir = path.join(ROOT, 'packages/amplience-core/esm');
    fs.mkdirSync(esmDir, { recursive: true });

    function toEsm(file, exportBlock) {
        const raw = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/^'use strict';\s*/m, '');
        const body = raw.replace(/module\.exports = \{[\s\S]*$/m, '');
        fs.writeFileSync(path.join(esmDir, file), body + exportBlock, 'utf8');
        console.log('wrote', path.join(esmDir, file));
    }

    toEsm('cdn.js', 'export { buildCdnUrl, buildCdnUrlById };\n');
    toEsm('transform.js', 'export { WIDGET_TYPES, WIDGET_TYPE_FILTERS, extractPreviewParts, extractPreviewPartsForLocale, detectWidgetType, mapToWidget, transformFetchedContent, toRendererModel, isMeaningfulMarkup, wrapMarkup, groupLocalizedPreviewFields };\n');

    let fetchBody = fs.readFileSync(path.join(SRC, 'fetch.js'), 'utf8')
        .replace(/^'use strict';\s*/m, '')
        .replace(/var cdn = require\('\.\/cdn'\);\s*/m, "import { buildCdnUrl, buildCdnUrlById } from './cdn.js';\n")
        .replace(/var transform = require\('\.\/transform'\);\s*/m, "import { toRendererModel } from './transform.js';\n")
        .replace(/cdn\.buildCdnUrl/g, 'buildCdnUrl')
        .replace(/transform\.toRendererModel/g, 'toRendererModel')
        .replace(/module\.exports = \{[\s\S]*$/m, 'export { unwrapCdnPayload, fetchLiveContent };\n');
    fs.writeFileSync(path.join(esmDir, 'fetch.js'), fetchBody, 'utf8');
    console.log('wrote', path.join(esmDir, 'fetch.js'));

    fs.writeFileSync(path.join(esmDir, 'index.js'), "export * from './cdn.js';\nexport * from './transform.js';\nexport * from './fetch.js';\n", 'utf8');
    console.log('wrote', path.join(esmDir, 'index.js'));
}

main();
