'use strict';

var paths    = require('*/cartridge/scripts/migration/core/migrationPaths');
var uploader = require('*/cartridge/scripts/migration/core/webDavUploader');

var MAX_VERSION = 999;
var MAX_SESSION_KEY_LEN = 50;

/**
 * Deterministic short hash for session.custom keys (api.session.maxKeyLength = 50).
 * @param {string} seed
 * @returns {string}
 */
function hashSeed(seed) {
    var raw  = String(seed || 'x');
    var hash = 0;
    var i;
    for (i = 0; i < raw.length; i++) {
        hash = ((hash << 5) - hash) + raw.charCodeAt(i);
        hash |= 0;
    }
    var suffix = Math.abs(hash).toString(36);
    while (suffix.length < 8) {
        suffix = '0' + suffix;
    }
    return suffix.substring(0, 10);
}

/**
 * @param {string} prefix
 * @param {string} seed
 * @returns {string}
 */
function buildSessionKey(prefix, seed) {
    var key = String(prefix || 'mk') + '_' + hashSeed(seed);
    return key.length > MAX_SESSION_KEY_LEN ? key.substring(0, MAX_SESSION_KEY_LEN) : key;
}

function sessionRunDateKey(moduleKey, prefix) {
    return buildSessionKey('mRD', moduleKey + (prefix || ''));
}

function sessionVersionStartKey(moduleKey, prefix) {
    return buildSessionKey('mVS', moduleKey + (prefix || ''));
}

function localFileExists(relativePath) {
    var File       = require('dw/io/File');
    var normalized = String(relativePath).replace(/\\/g, '/');
    var file       = new File(File.IMPEX + File.SEPARATOR + normalized.replace(/\//g, File.SEPARATOR));
    return file.exists() && file.isFile();
}

function moduleFileExists(moduleKey, runDate, version, storage, prefix) {
    var fileName = paths.buildXmlFileName(moduleKey, runDate, version, prefix);
    var relPath  = paths.getRelativePath(moduleKey);
    if (storage === 'local') {
        return localFileExists(relPath + '/' + fileName);
    }
    return uploader.fileExists(relPath, fileName);
}

/**
 * @param {string} moduleKey
 * @param {number} offset
 * @param {string} [prefix] - source-platform prefix, e.g. 'ctp' or 'shp'
 * @returns {string} YYYYMMDD
 */
function getRunDate(moduleKey, offset, prefix) {
    var key = sessionRunDateKey(moduleKey, prefix);
    if (offset === 0 || !session.custom[key]) {
        session.custom[key] = paths.formatRunDate(new Date());
    }
    return String(session.custom[key]);
}

/**
 * @param {string} moduleKey
 * @param {string} runDate
 * @param {number} offset
 * @param {string} [storage] - 'webdav' (default) or 'local'
 * @param {string} [prefix] - source-platform prefix, e.g. 'ctp' or 'shp'
 * @returns {number}
 */
function getVersionStart(moduleKey, runDate, offset, storage, prefix) {
    var vKey = sessionVersionStartKey(moduleKey, prefix);

    if (offset === 0 || !session.custom[vKey]) {
        var version = 1;
        while (version <= MAX_VERSION) {
            if (!moduleFileExists(moduleKey, runDate, version, storage, prefix)) {
                session.custom[vKey] = String(version);
                return version;
            }
            version++;
        }
        session.custom[vKey] = '1';
        return 1;
    }
    return parseInt(session.custom[vKey], 10) || 1;
}

/**
 * Resolve a non-colliding XML file name for a migration batch.
 * @param {string} moduleKey
 * @param {number} offset
 * @param {number} batchSize
 * @param {string} [storage] - 'webdav' or 'local'
 * @param {string} [prefix] - source-platform prefix, e.g. 'ctp' or 'shp'
 * @returns {string}
 */
function resolveXmlFileName(moduleKey, offset, batchSize, storage, prefix) {
    var store        = storage || 'webdav';
    var runDate      = getRunDate(moduleKey, offset, prefix);
    var versionStart = getVersionStart(moduleKey, runDate, offset, store, prefix);
    var batchIndex   = Math.floor(offset / (batchSize || 1));
    var version      = versionStart + batchIndex;

    while (version <= MAX_VERSION && moduleFileExists(moduleKey, runDate, version, store, prefix)) {
        version++;
    }
    return paths.buildXmlFileName(moduleKey, runDate, version, prefix);
}

/**
 * Resolve a single, stable XML file name for an entire multi-batch run
 * (same name returned for every offset in the run, so batches can be
 * merged into one file instead of one file per batch).
 * @param {string} moduleKey
 * @param {number} offset
 * @param {string} [storage] - 'webdav' or 'local'
 * @param {string} [prefix] - source-platform prefix, e.g. 'ctp' or 'shp'
 * @returns {string}
 */
function resolveRunFileName(moduleKey, offset, storage, prefix) {
    var store   = storage || 'webdav';
    var runDate = getRunDate(moduleKey, offset, prefix);
    var version = getVersionStart(moduleKey, runDate, offset, store, prefix);
    return paths.buildXmlFileName(moduleKey, runDate, version, prefix);
}

module.exports = {
    getRunDate:         getRunDate,
    resolveXmlFileName: resolveXmlFileName,
    resolveRunFileName: resolveRunFileName,
    getRelativePath:    paths.getRelativePath,
    localFileExists:    localFileExists,
    sessionRunDateKey:  sessionRunDateKey
};
