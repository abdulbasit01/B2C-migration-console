'use strict';

var fetcher      = require('*/cartridge/scripts/migration/productMigration/ctpProductFetcher');
var xmlBuilder   = require('*/cartridge/scripts/migration/productMigration/productXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/productMigration/productWebDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');

var MODULE_KEY = 'product';
var BATCH_SIZE = 500;

/**
 * Run one migration batch — fetches BATCH_SIZE products from CTP, builds
 * SFCC catalog XML, and uploads to WebDAV.
 *
 * @param {number} offset           - CTP pagination offset
 * @param {string} catalogId        - target SFCC catalog ID
 * @param {Array}  selectedVarAttrs - CTP attr names to include (null = all)
 * @returns {{ ok, total, nextOffset, done, built, failed, errors }}
 */
function runBatch(offset, catalogId, selectedVarAttrs) {
    if (!catalogId) return { ok: false, error: 'catalogId is required' };

    var batch    = fetcher.fetchBatch(offset, BATCH_SIZE);
    var rawProds = batch.results;
    var total    = batch.total;

    if (!rawProds || rawProds.length === 0) {
        return {
            ok: true, total: total, nextOffset: offset, done: true,
            built: 0, failed: 0, errors: [],
            impexPath: fileResolver.getRelativePath(MODULE_KEY)
        };
    }

    var dirResult = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    var runDate   = fileResolver.getRunDate(MODULE_KEY, offset);
    var fileName  = fileResolver.resolveXmlFileName(MODULE_KEY, offset, BATCH_SIZE, 'webdav');
    var impexPath = fileResolver.getRelativePath(MODULE_KEY);

    var catalogResult = xmlBuilder.buildXml(rawProds, catalogId, selectedVarAttrs);
    var putResult     = uploader.uploadFile(fileName, catalogResult.xml);
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
        errors:     catalogResult.errors || [],
        fileName:   fileName,
        runDate:    runDate,
        impexPath:  impexPath
    };
}

/**
 * Migrate a single product by CTP product ID — fetches from CTP, builds XML,
 * uploads to WebDAV.
 *
 * @param {string} ctpId            - CTP product UUID
 * @param {string} catalogId        - target SFCC catalog ID
 * @param {Array}  selectedVarAttrs - CTP attr names to include (null = all)
 * @returns {{ ok, built, failed, errors }}
 */
function runById(ctpId, catalogId, selectedVarAttrs) {
    if (!ctpId)     return { ok: false, error: 'ctpId is required' };
    if (!catalogId) return { ok: false, error: 'catalogId is required' };

    var product = fetcher.fetchById(ctpId);

    var dirResult = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    var fileName      = fileResolver.resolveXmlFileName(MODULE_KEY, 0, 1, 'webdav');
    var catalogResult = xmlBuilder.buildXml([product], catalogId, selectedVarAttrs);
    var putResult     = uploader.uploadFile(fileName, catalogResult.xml);
    if (!putResult.ok) {
        return { ok: false, error: 'WebDAV upload failed: ' + putResult.error };
    }

    return {
        ok:        true,
        built:     catalogResult.built,
        failed:    catalogResult.failed,
        errors:    catalogResult.errors || [],
        fileName:  fileName,
        impexPath: fileResolver.getRelativePath(MODULE_KEY)
    };
}

module.exports = { runBatch: runBatch, runById: runById };
