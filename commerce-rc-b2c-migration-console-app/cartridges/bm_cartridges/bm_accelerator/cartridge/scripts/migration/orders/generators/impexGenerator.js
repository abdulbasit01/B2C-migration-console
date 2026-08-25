'use strict';

var File       = require('dw/io/File');
var FileWriter = require('dw/io/FileWriter');

var paths        = require('*/cartridge/scripts/migration/core/migrationPaths');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');

var MODULE_KEY = 'order';

function parentRelativePath(relativePath) {
    var normalized = String(relativePath).replace(/\\/g, '/');
    var idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.substring(0, idx) : '';
}

function ensureDir(relativePath) {
    var dir = new File(File.IMPEX + File.SEPARATOR + relativePath);
    if (!dir.exists()) {
        dir.mkdirs();
    }
    return dir;
}

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

function resolveZipName(runDate) {
    var moduleId = paths.MODULE_IDS[MODULE_KEY];
    var version  = 1;
    var relPath  = paths.getRelativePath(MODULE_KEY);
    while (version <= 999) {
        var zipName = moduleId + '-' + runDate + '-export-v'
            + (version < 10 ? '00' : (version < 100 ? '0' : '')) + version + '.zip';
        if (!fileResolver.localFileExists(relPath + '/' + zipName)) {
            return zipName;
        }
        version++;
    }
    return moduleId + '-' + runDate + '-export-v001.zip';
}

/**
 * Generate IMPEX package under src/migration/order/.
 * @param {Object[]} xmlChunks - { fileName, content }[]
 * @returns {Object}
 */
function generatePackage(xmlChunks) {
    var relPath = paths.getRelativePath(MODULE_KEY);
    ensureDir(relPath);

    var runDate      = fileResolver.getRunDate(MODULE_KEY, 0);
    var writtenFiles = [];
    var offset       = 0;

    for (var i = 0; i < xmlChunks.length; i++) {
        var chunk    = xmlChunks[i];
        var fileName = fileResolver.resolveXmlFileName(MODULE_KEY, offset, 1, 'local');
        var relFile  = relPath + '/' + fileName;
        var file     = writeFile(relFile, chunk.content);
        writtenFiles.push({
            fileName:     fileName,
            relativePath: relFile,
            file:         file
        });
        offset++;
    }

    var zipName = resolveZipName(runDate);
    var zipRel  = relPath + '/' + zipName;
    var zipFile = createZip(zipRel, relPath);

    return {
        runId:       runDate,
        runDate:     runDate,
        impexPath:   relPath,
        files:       writtenFiles,
        zipPath:     zipRel,
        zipFileName: zipName,
        zipFile:     zipFile
    };
}

function listRuns() {
    var base = new File(File.IMPEX + File.SEPARATOR + paths.getRelativePath(MODULE_KEY));
    if (!base.exists()) return [];
    var children = base.listFiles();
    var runs = [];
    if (children) {
        for (var i = 0; i < children.length; i++) {
            if (children[i].isFile() && children[i].getName().indexOf('.xml') > 0) {
                runs.push(children[i].getName());
            }
        }
    }
    return runs;
}

module.exports = {
    MIGRATION_BASE:   paths.MIGRATION_BASE,
    IMPEX_SRC:        'src',
    ORDERS_SUBDIR:    paths.MODULE_IDS.order,
    ensureDir:        ensureDir,
    writeFile:        writeFile,
    createZip:        createZip,
    generatePackage:  generatePackage,
    listRuns:         listRuns
};
