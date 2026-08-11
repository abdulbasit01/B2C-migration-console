'use strict';

var File       = require('dw/io/File');
var FileWriter = require('dw/io/FileWriter');

/**
 * Ensure IMPEX subdirectory exists.
 * @param {string} relativePath - e.g. src/migration/inventory
 * @returns {dw.io.File}
 */
function ensureDir(relativePath) {
    var dir = new File(
        File.IMPEX + File.SEPARATOR + String(relativePath).replace(/\//g, File.SEPARATOR)
    );
    if (!dir.exists()) {
        dir.mkdirs();
    }
    return dir;
}

/**
 * Open a UTF-8 writer on IMPEX/{relativePath}/{fileName}.
 * @param {string} relativePath
 * @param {string} fileName
 * @returns {{ writer: dw.io.FileWriter, file: dw.io.File }}
 */
function openWriter(relativePath, fileName) {
    var dir  = ensureDir(relativePath);
    var file = new File(dir, fileName);
    return {
        writer: new FileWriter(file, 'UTF-8'),
        file:   file
    };
}

/**
 * @param {dw.io.FileWriter} writer
 */
function closeWriter(writer) {
    if (writer) {
        writer.close();
    }
}

module.exports = {
    ensureDir:   ensureDir,
    openWriter:  openWriter,
    closeWriter: closeWriter
};
