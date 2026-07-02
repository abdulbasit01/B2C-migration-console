'use strict';

/* global request */

var paths = require('*/cartridge/scripts/migration/core/migrationPaths');

function getSettings() {
    var sfccClient = require('*/cartridge/scripts/migration/sfccClient');
    var s          = sfccClient.getSFCCSettings();
    return {
        bmUsername: s.bmUsername,
        bmPassword: s.bmPassword
    };
}

function toBase64(str) {
    var Encoding = require('dw/crypto/Encoding');
    var Bytes    = require('dw/util/Bytes');
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function basicAuth() {
    var s = getSettings();
    return 'Basic ' + toBase64(s.bmUsername + ':' + s.bmPassword);
}

/**
 * @param {string} moduleRelativePath - e.g. src/migration/customer
 * @returns {string}
 */
function webdavBase(moduleRelativePath) {
    return 'https://' + request.httpHost
        + '/on/demandware.servlet/webdav/Sites/Impex/'
        + moduleRelativePath + '/';
}

/**
 * @param {string} moduleRelativePath
 * @returns {{ ok: boolean, error: null }}
 */
function ensureDirectory(moduleRelativePath) {
    return { ok: true, error: null };
}

/**
 * @param {string} moduleRelativePath
 * @param {string} fileName
 * @returns {boolean}
 */
function fileExists(moduleRelativePath, fileName) {
    var HTTPClient = require('dw/net/HTTPClient');
    var client     = new HTTPClient();
    client.setTimeout(15000);
    client.open('HEAD', webdavBase(moduleRelativePath) + fileName);
    client.setRequestHeader('Authorization', basicAuth());
    client.send();
    return client.getStatusCode() === 200;
}

/**
 * @param {string} moduleRelativePath
 * @param {string} fileName
 * @param {string} content
 * @param {string} [contentType]
 * @returns {{ ok: boolean, error: string|null }}
 */
function uploadFile(moduleRelativePath, fileName, content, contentType) {
    var HTTPClient = require('dw/net/HTTPClient');
    var client     = new HTTPClient();
    client.setTimeout(60000);
    client.open('PUT', webdavBase(moduleRelativePath) + fileName);
    client.setRequestHeader('Authorization', basicAuth());
    client.setRequestHeader('Content-Type', contentType || 'text/xml; charset=UTF-8');
    client.send(content);
    var status = client.getStatusCode();
    if (status === 200 || status === 201 || status === 204) {
        return { ok: true, error: null };
    }
    return { ok: false, error: 'WebDAV PUT failed (' + status + '): ' + client.getText() };
}

/**
 * Confirm a file was written under IMPEX (no WebDAV round-trip).
 * Inventory streaming writes directly to File.IMPEX; BM import reads from there.
 * @param {string} moduleRelativePath
 * @param {string} fileName
 * @returns {{ ok: boolean, error: string|null }}
 */
function uploadLocalFile(moduleRelativePath, fileName) {
    var File = require('dw/io/File');
    var rel  = String(moduleRelativePath).replace(/\\/g, '/');
    var file = new File(
        File.IMPEX + File.SEPARATOR + rel.replace(/\//g, File.SEPARATOR) + File.SEPARATOR + fileName
    );
    if (!file.exists() || !file.isFile()) {
        return { ok: false, error: 'Local IMPEX file not found: ' + rel + '/' + fileName };
    }
    if (file.length() === 0) {
        return { ok: false, error: 'Generated IMPEX file is empty: ' + fileName };
    }
    return { ok: true, error: null };
}

module.exports = {
    MIGRATION_BASE:    paths.MIGRATION_BASE,
    webdavBase:        webdavBase,
    ensureDirectory:   ensureDirectory,
    fileExists:        fileExists,
    uploadFile:        uploadFile,
    uploadLocalFile:   uploadLocalFile
};
