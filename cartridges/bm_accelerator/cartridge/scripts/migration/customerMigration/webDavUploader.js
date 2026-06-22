'use strict';

/* global request */

/**
 * Upload customer XML import files to SFCC WebDAV.
 * Uses Basic Auth with BM credentials from sfccClient.getSFCCSettings().
 * All requires are deferred inside functions to avoid module-load failures in Rhino.
 */

function getSettings() {
    var sfccClient = require('*/cartridge/scripts/migration/sfccClient');
    var s          = sfccClient.getSFCCSettings();
    return {
        baseUrl:     'https://' + request.httpHost,
        bmUsername:  s.bmUsername,
        bmPassword:  s.bmPassword
    };
}

function toBase64(str) {
    var Encoding = require('dw/crypto/Encoding');
    var Bytes    = require('dw/util/Bytes');
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function webdavBase() {
    return 'https://' + request.httpHost + '/on/demandware.servlet/webdav/Sites/Impex/src/instance/ctp-migration/';
}

function basicAuth() {
    var s = getSettings();
    return 'Basic ' + toBase64(s.bmUsername + ':' + s.bmPassword);
}

/**
 * No-op — SFCC WebDAV auto-creates subdirectories under /Impex/src/instance/ on first PUT.
 * dw/net/HTTPClient does not support the MKCOL verb (throws IOException).
 * @returns {{ ok: boolean, error: null }}
 */
function ensureDirectory() {
    return { ok: true, error: null };
}

/**
 * Upload an XML file to the ctp-migration WebDAV directory.
 * @param {string} fileName - file name only (e.g. "customers-0.xml")
 * @param {string} content  - XML string content
 * @returns {{ ok: boolean, error: string|null }}
 */
function uploadFile(fileName, content) {
    var HTTPClient = require('dw/net/HTTPClient');
    var client = new HTTPClient();
    client.setTimeout(60000);
    client.open('PUT', webdavBase() + fileName);
    client.setRequestHeader('Authorization', basicAuth());
    client.setRequestHeader('Content-Type', 'text/xml; charset=UTF-8');
    client.send(content);
    var status = client.getStatusCode();
    if (status === 200 || status === 201 || status === 204) {
        return { ok: true, error: null };
    }
    return { ok: false, error: 'WebDAV PUT failed (' + status + '): ' + client.getText() };
}

module.exports = { ensureDirectory: ensureDirectory, uploadFile: uploadFile };
