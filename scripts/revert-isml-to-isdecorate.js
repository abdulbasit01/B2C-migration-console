'use strict';

const fs   = require('fs');
const path = require('path');

const ISML_DIR = path.resolve(__dirname, '../cartridges/bm_accelerator/cartridge/templates/default/accelerator');

const files = fs.readdirSync(ISML_DIR).filter(f => f.endsWith('.isml'));

let converted = 0;

for (const file of files) {
    const filePath = path.join(ISML_DIR, file);
    let content = fs.readFileSync(filePath, 'utf8');

    if (!content.trimStart().startsWith('<!DOCTYPE html>')) {
        console.log('Skip (already reverted):', file);
        continue;
    }

    // Remove: <!DOCTYPE html>\n<html ...>\n<head>\n  <meta charset...>\n  <meta name="viewport"...>\n
    content = content.replace(
        /^<!DOCTYPE html>\s*\r?\n<html[^>]*>\s*\r?\n<head>\s*\r?\n[ \t]*<meta charset="UTF-8"\/>\s*\r?\n[ \t]*<meta name="viewport"[^>]*\/>\s*\r?\n/,
        ''
    );

    // Remove: </head>\n<body>\n  (keep whatever was between meta tags and </head>, e.g. <link>, <script>, <style>)
    content = content.replace(/[ \t]*<\/head>\s*\r?\n<body>\s*\r?\n?/, '\n');

    // Remove: </body>\n</html> at end
    content = content.replace(/\s*<\/body>\s*\r?\n<\/html>\s*\r?\n?$/, '\n');

    // Wrap with isdecorate
    content = '<isdecorate template="application/MenuFrame">\n'
            + '<iscontent type="text/html" charset="UTF-8"/>\n'
            + content.trimStart()
            + '</isdecorate>\n';

    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Reverted:', file);
    converted++;
}

console.log('\nDone. Reverted', converted, 'of', files.length, 'files.');
