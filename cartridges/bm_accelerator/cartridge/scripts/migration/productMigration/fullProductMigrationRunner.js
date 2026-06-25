'use strict';

var fetcher    = require('*/cartridge/scripts/migration/productMigration/ctpProductFetcher');
var xmlBuilder = require('*/cartridge/scripts/migration/productMigration/productXmlBuilder');
var uploader   = require('*/cartridge/scripts/migration/productMigration/productWebDavUploader');

var BATCH_SIZE = 500;

/**
 * Run one migration batch — fetches BATCH_SIZE products from CTP, builds
 * SFCC catalog XML, and uploads to WebDAV.
 *
 * @param {number} offset    - CTP pagination offset
 * @param {string} catalogId - target SFCC catalog ID (read from config.js sfcc.catalogId)
 * @returns {{ ok, total, nextOffset, done, built, failed, errors }}
 */
function runBatch(offset, catalogId) {
    if (!catalogId) return { ok: false, error: 'catalogId is required' };

    var batch    = fetcher.fetchBatch(offset, BATCH_SIZE);
    var rawProds = batch.results;
    var total    = batch.total;

    if (!rawProds || rawProds.length === 0) {
        return { ok: true, total: total, nextOffset: offset, done: true, built: 0, failed: 0, errors: [] };
    }

    var dirResult = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    if (offset === 0) {
        uploader.uploadFile('config.json', JSON.stringify({ catalogId: catalogId }));
    }

    var catalogResult = xmlBuilder.buildXml(rawProds, catalogId);
    var putResult     = uploader.uploadFile('products-' + offset + '.xml', catalogResult.xml);
    if (!putResult.ok) {
        return { ok: false, error: 'WebDAV upload failed: ' + putResult.error };
    }

    var nextOffset = offset + rawProds.length;
    return {
        ok:         true,
        total:      total,
        nextOffset: nextOffset,
        done:       nextOffset >= total || rawProds.length === 0,
        built:      catalogResult.built,
        failed:     catalogResult.failed,
        errors:     catalogResult.errors || []
    };
}

/**
 * Migrate a single product by CTP product ID — fetches from CTP, builds XML,
 * uploads to WebDAV as products-<id>.xml.
 *
 * @param {string} ctpId     - CTP product UUID
 * @param {string} catalogId - target SFCC catalog ID
 * @returns {{ ok, built, failed, errors }}
 */
function runById(ctpId, catalogId) {
    if (!ctpId)     return { ok: false, error: 'ctpId is required' };
    if (!catalogId) return { ok: false, error: 'catalogId is required' };

    var product = fetcher.fetchById(ctpId);

    var dirResult = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    var catalogResult = xmlBuilder.buildXml([product], catalogId);
    var safeId        = ctpId.replace(/[^a-zA-Z0-9_-]/g, '-');
    var putResult     = uploader.uploadFile('products-' + safeId + '.xml', catalogResult.xml);
    if (!putResult.ok) {
        return { ok: false, error: 'WebDAV upload failed: ' + putResult.error };
    }

    return {
        ok:     true,
        built:  catalogResult.built,
        failed: catalogResult.failed,
        errors: catalogResult.errors || []
    };
}

module.exports = { runBatch: runBatch, runById: runById };
