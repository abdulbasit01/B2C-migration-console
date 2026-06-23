'use strict';

/* global request */

function getSettings() {
    var sfccClient = require('*/cartridge/scripts/migration/sfccClient');
    return sfccClient.getSFCCSettings();
}

function toBase64(str) {
    var Encoding = require('dw/crypto/Encoding');
    var Bytes    = require('dw/util/Bytes');
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function webdavBase() {
    return 'https://' + request.httpHost + '/on/demandware.servlet/webdav/Sites/Impex/src/instance/ctp-product-migration/';
}

function basicAuth() {
    var s = getSettings();
    return 'Basic ' + toBase64(s.bmUsername + ':' + s.bmPassword);
}

function ensureDirectory() {
    return { ok: true, error: null };
}

/**
 * Upload a file to the ctp-product-migration WebDAV directory.
 * @param {string} fileName - e.g. "products-0.xml" or "config.json"
 * @param {string} content
 * @returns {{ ok: boolean, error: string|null }}
 */
function uploadFile(fileName, content) {
    var HTTPClient = require('dw/net/HTTPClient');
    var client     = new HTTPClient();
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
