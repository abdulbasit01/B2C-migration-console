'use strict';

var fetcher      = require('*/cartridge/scripts/migration/productMigration/ctpProductFetcher');
var xmlBuilder   = require('*/cartridge/scripts/migration/productMigration/productXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/productMigration/productWebDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');

var MODULE_KEY = 'product';
var BATCH_SIZE = 500;

function runBatch(offset, catalogId) {
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

    if (offset === 0) {
        uploader.uploadFile('config.json', JSON.stringify({
            catalogId: catalogId,
            module:    MODULE_KEY,
            runDate:   runDate,
            impexPath: impexPath
        }));
    }

    var catalogResult = xmlBuilder.buildXml(rawProds, catalogId);
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

function runById(ctpId, catalogId) {
    if (!ctpId)     return { ok: false, error: 'ctpId is required' };
    if (!catalogId) return { ok: false, error: 'catalogId is required' };

    var product = fetcher.fetchById(ctpId);

    var dirResult = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    var fileName      = fileResolver.resolveXmlFileName(MODULE_KEY, 0, 1, 'webdav');
    var catalogResult = xmlBuilder.buildXml([product], catalogId);
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
