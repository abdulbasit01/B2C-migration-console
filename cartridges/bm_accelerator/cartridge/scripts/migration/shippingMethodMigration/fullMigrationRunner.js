'use strict';

var fetcher      = require('*/cartridge/scripts/migration/shippingMethodMigration/ctpShippingMethodFetcher');
var xmlBuilder   = require('*/cartridge/scripts/migration/shippingMethodMigration/shippingMethodXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/shippingMethodMigration/webDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');

var MODULE_KEY = 'shippingMethod';
var BATCH_SIZE = 50;

function uploadBatchXml(methods, siteId, offset, total) {
    if (!methods || !methods.length) {
        return { ok: true, built: 0, failed: 0, errors: [], fileName: null };
    }

    var runDate  = fileResolver.getRunDate(MODULE_KEY, offset);
    var fileName = fileResolver.resolveXmlFileName(MODULE_KEY, offset, BATCH_SIZE, 'webdav');
    var impexPath = fileResolver.getRelativePath(MODULE_KEY);

    var buildResult = xmlBuilder.buildXml(methods);
    var dirResult   = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    var putResult = uploader.uploadFile(fileName, buildResult.xml);
    if (!putResult.ok) {
        return { ok: false, error: 'WebDAV upload failed: ' + putResult.error };
    }

    return {
        ok:        true,
        built:     buildResult.built,
        failed:    buildResult.failed,
        errors:    buildResult.errors,
        fileName:  fileName,
        runDate:   runDate,
        impexPath: impexPath
    };
}

function runBatch(offset, siteId) {
    if (!siteId) return { ok: false, error: 'siteId is required' };

    var batch   = fetcher.fetchBatch(offset, BATCH_SIZE);
    var methods = batch.results;
    var total   = batch.total;

    if (!methods || methods.length === 0) {
        return {
            ok: true, total: total, nextOffset: offset, done: true,
            built: 0, failed: 0, errors: [],
            impexPath: fileResolver.getRelativePath(MODULE_KEY)
        };
    }

    var upload = uploadBatchXml(methods, siteId, offset, total);
    if (!upload.ok) {
        return { ok: false, error: upload.error };
    }

    var nextOffset = offset + methods.length;
    return {
        ok:         true,
        total:      total,
        nextOffset: nextOffset,
        done:       nextOffset >= total || methods.length === 0,
        built:      upload.built,
        failed:     upload.failed,
        errors:     upload.errors,
        fileName:   upload.fileName,
        runDate:    upload.runDate,
        impexPath:  upload.impexPath
    };
}

function runBatchForKeys(keys, offset, siteId) {
    if (!siteId) return { ok: false, error: 'siteId is required' };

    var refs  = keys || [];
    var total = refs.length;
    if (!total) {
        return {
            ok: true, total: 0, nextOffset: 0, done: true,
            built: 0, failed: 0, errors: [],
            impexPath: fileResolver.getRelativePath(MODULE_KEY)
        };
    }

    var slice   = refs.slice(offset, offset + BATCH_SIZE);
    var methods = [];
    var errors  = [];

    for (var i = 0; i < slice.length; i++) {
        try {
            var m = fetcher.fetchByKeyOrId(slice[i]);
            if (m) {
                methods.push(m);
            } else if (errors.length < 5) {
                errors.push(slice[i] + ': not found in CTP');
            }
        } catch (fe) {
            if (errors.length < 5) {
                errors.push(slice[i] + ': ' + (fe.message || String(fe)));
            }
        }
    }

    if (!methods.length) {
        var nextEmpty = offset + slice.length;
        return {
            ok:         true,
            total:      total,
            nextOffset: nextEmpty,
            done:       nextEmpty >= total,
            built:      0,
            failed:     slice.length,
            errors:     errors,
            impexPath:  fileResolver.getRelativePath(MODULE_KEY)
        };
    }

    var upload = uploadBatchXml(methods, siteId, offset, total);
    if (!upload.ok) {
        return { ok: false, error: upload.error };
    }

    var nextOffset = offset + slice.length;
    return {
        ok:         true,
        total:      total,
        nextOffset: nextOffset,
        done:       nextOffset >= total,
        built:      upload.built,
        failed:     upload.failed + (slice.length - methods.length),
        errors:     errors.concat(upload.errors || []),
        fileName:   upload.fileName,
        runDate:    upload.runDate,
        impexPath:  upload.impexPath
    };
}

module.exports = { runBatch: runBatch, runBatchForKeys: runBatchForKeys };
