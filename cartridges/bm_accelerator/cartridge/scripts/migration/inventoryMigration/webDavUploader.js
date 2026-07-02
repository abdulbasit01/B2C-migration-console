'use strict';

var corePaths    = require('*/cartridge/scripts/migration/core/migrationPaths');
var coreUploader = require('*/cartridge/scripts/migration/core/webDavUploader');

var REL_PATH = corePaths.getRelativePath('inventory');

function ensureDirectory() {
    return coreUploader.ensureDirectory(REL_PATH);
}

function fileExists(fileName) {
    return coreUploader.fileExists(REL_PATH, fileName);
}

function uploadFile(fileName, content, contentType) {
    return coreUploader.uploadFile(REL_PATH, fileName, content, contentType);
}

/**
 * Upload a file already written under IMPEX/{REL_PATH}/ via WebDAV (avoids large in-memory XML strings).
 * @param {string} fileName
 * @returns {{ ok: boolean, error: string|null }}
 */
function uploadLocalFile(fileName) {
    return coreUploader.uploadLocalFile(REL_PATH, fileName);
}

module.exports = {
    ensureDirectory:      ensureDirectory,
    fileExists:           fileExists,
    uploadFile:           uploadFile,
    uploadLocalFile:      uploadLocalFile,
    MODULE_RELATIVE_PATH: REL_PATH
};
