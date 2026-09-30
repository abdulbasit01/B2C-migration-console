'use strict';

/**
 * Pure helpers for CT product XML file splitting.
 * The API fetch size is intentionally separate from the XML file limit.
 */

var MAX_PER_FILE = 20000;
// Operational target, not an SFCC platform quota. Count remains a second safety cap.
var MAX_BYTES_PER_FILE = 100 * 1024 * 1024;

function expectedFileCount(total, maxPerFile) {
    var max = maxPerFile || MAX_PER_FILE;
    if (!total || total < 1) return 1;
    return Math.ceil(total / max);
}

function shouldRotate(productCount, byteCount, maxProducts, maxBytes) {
    var countLimit = maxProducts || MAX_PER_FILE;
    var byteLimit = maxBytes || MAX_BYTES_PER_FILE;
    return productCount >= countLimit || byteCount >= byteLimit;
}

function padPart(part) {
    var value = String(part < 1 ? 1 : part);
    while (value.length < 4) value = '0' + value;
    return value;
}

function buildPartFileName(stem, part) {
    var base = String(stem || 'product.xml');
    if (/\.xml$/i.test(base)) {
        return base.replace(/\.xml$/i, '-p' + padPart(part) + '.xml');
    }
    return base + '-p' + padPart(part) + '.xml';
}

module.exports = {
    MAX_PER_FILE:       MAX_PER_FILE,
    MAX_BYTES_PER_FILE: MAX_BYTES_PER_FILE,
    expectedFileCount:  expectedFileCount,
    shouldRotate:       shouldRotate,
    padPart:            padPart,
    buildPartFileName:  buildPartFileName
};
