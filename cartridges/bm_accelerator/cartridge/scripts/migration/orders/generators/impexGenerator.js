'use strict';

var File       = require('dw/io/File');
var FileWriter = require('dw/io/FileWriter');

var MIGRATION_BASE = 'src/migration';
var IMPEX_SRC      = 'src';
var ORDERS_SUBDIR  = 'orders';
/**
 * Parent directory portion of a relative IMPEX path.
 * @param {string} relativePath
 * @returns {string}
 */
function parentRelativePath(relativePath) {
    var normalized = String(relativePath).replace(/\\/g, '/');
    var idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.substring(0, idx) : '';
}

/**
 * Ensure a directory exists under IMPEX.
 * @param {string} relativePath - path relative to IMPEX root
 * @returns {dw.io.File}
 */
function ensureDir(relativePath) {
    var dir = new File(File.IMPEX + File.SEPARATOR + relativePath);
    if (!dir.exists()) {
        dir.mkdirs();
    }
    return dir;
}

/**
 * Write a text file under IMPEX.
 * @param {string} relativePath - e.g. src/migration/{runId}/src/orders/orders_001.xml
 * @param {string} content
 * @returns {dw.io.File}
 */
function writeFile(relativePath, content) {
    var normalized = String(relativePath).replace(/\\/g, '/');
    var parentPath = parentRelativePath(normalized);
    if (parentPath) {
        ensureDir(parentPath);
    }
    var file = new File(File.IMPEX + File.SEPARATOR + normalized);
    var writer = new FileWriter(file, 'UTF-8');
    writer.write(content);
    writer.close();
    return file;
}

/**
 * Create a ZIP archive from a directory under IMPEX using dw.io.File.zip().
 * @param {string} zipRelativePath - e.g. src/migration/{runId}/orders_export.zip
 * @param {string} sourceRelativePath - directory to zip (e.g. src/migration/{runId}/src)
 * @returns {dw.io.File}
 */
function createZip(zipRelativePath, sourceRelativePath) {
    var normalized = String(zipRelativePath).replace(/\\/g, '/');
    var parentPath = parentRelativePath(normalized);
    if (parentPath) {
        ensureDir(parentPath);
    }
    var zipFile = new File(File.IMPEX + File.SEPARATOR + normalized);
    var sourceDir = new File(File.IMPEX + File.SEPARATOR + String(sourceRelativePath).replace(/\\/g, '/'));
    if (!sourceDir.exists() || !sourceDir.isDirectory()) {
        throw new Error('ZIP source directory not found: ' + sourceRelativePath);
    }
    sourceDir.zip(zipFile);
    return zipFile;
}
/**
 * Generate IMPEX package: write XML files and create ZIP.
 * @param {Object[]} xmlChunks - { fileName, content }[]
 * @param {string} [runId] - optional run identifier for subdirectory
 * @returns {Object} { files, zipPath, zipFileName }
 */
function generatePackage(xmlChunks, runId) {
    var runFolder  = runId || String(Date.now());
    var basePath   = MIGRATION_BASE + File.SEPARATOR + runFolder;
    var srcPath    = basePath + File.SEPARATOR + IMPEX_SRC;
    var ordersPath = srcPath + File.SEPARATOR + ORDERS_SUBDIR;

    ensureDir(ordersPath);

    var writtenFiles = [];

    for (var i = 0; i < xmlChunks.length; i++) {
        var chunk      = xmlChunks[i];
        var relPath    = ordersPath.replace(/\\/g, '/') + '/' + chunk.fileName;
        var normalized = relPath.replace(/\\/g, '/');
        var file       = writeFile(normalized, chunk.content);
        writtenFiles.push({
            fileName:     chunk.fileName,
            relativePath: normalized,
            file:         file
        });
    }

    var zipName = 'orders_export_' + runFolder + '.zip';
    var zipRel  = basePath.replace(/\\/g, '/') + '/' + zipName;
    var zipFile = createZip(zipRel, srcPath.replace(/\\/g, '/'));
    return {
        runId:      runFolder,
        files:      writtenFiles,
        zipPath:    zipRel,
        zipFileName: zipName,
        zipFile:    zipFile
    };
}

/**
 * List migration run directories under IMPEX/src/migration.
 * @returns {string[]}
 */
function listRuns() {
    var base = new File(File.IMPEX + File.SEPARATOR + MIGRATION_BASE);
    if (!base.exists()) return [];
    var children = base.listFiles();
    var runs = [];
    if (children) {
        for (var i = 0; i < children.length; i++) {
            if (children[i].isDirectory()) {
                runs.push(children[i].getName());
            }
        }
    }
    return runs;
}

module.exports = {
    MIGRATION_BASE:   MIGRATION_BASE,
    IMPEX_SRC:        IMPEX_SRC,
    ORDERS_SUBDIR:    ORDERS_SUBDIR,
    ensureDir:        ensureDir,
    writeFile:        writeFile,
    createZip:        createZip,
    generatePackage:  generatePackage,
    listRuns:         listRuns
};
