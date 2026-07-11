'use strict';

var fetcher      = require('*/cartridge/scripts/migration/shippingMethodMigration/ctpShippingMethodFetcher');
var xmlBuilder   = require('*/cartridge/scripts/migration/shippingMethodMigration/shippingMethodXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/shippingMethodMigration/webDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var streamWriter = require('*/cartridge/scripts/migration/core/impexStreamWriter');

var MODULE_KEY              = 'shippingMethod';
var BATCH_SIZE              = 50;
var MAX_SINGLE_FILE_ENTRIES = 10000;

function uploadBatchXml(methods, offset) {
    if (!methods || !methods.length) {
        return { ok: true, built: 0, failed: 0, errors: [], fileName: null };
    }

    var runDate   = fileResolver.getRunDate(MODULE_KEY, offset);
    var fileName  = fileResolver.resolveXmlFileName(MODULE_KEY, offset, BATCH_SIZE, 'webdav');
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

function writeMethod(writer, ctpMethod, stats) {
    try {
        writer.write(xmlBuilder.buildShippingMethodXml(ctpMethod));
        stats.built++;
    } catch (e) {
        stats.failed++;
        if (stats.errors.length < 5) {
            stats.errors.push((ctpMethod.key || ctpMethod.id || '?') + ': ' + (e.message || String(e)));
        }
    }
}

function runSingleFile(keys) {
    var impexPath = fileResolver.getRelativePath(MODULE_KEY);
    var resolved  = fileResolver.resolveXmlFileName(MODULE_KEY, 0, BATCH_SIZE, 'webdav');
    var runDate   = fileResolver.getRunDate(MODULE_KEY, 0);
    var stream    = null;
    var writer    = null;
    var stats     = { built: 0, failed: 0, errors: [] };
    var total     = 0;
    var offset    = 0;
    var results   = [];

    try {
        var dirResult = uploader.ensureDirectory();
        if (!dirResult.ok) {
            return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
        }

        stream = streamWriter.openWriter(impexPath, resolved);
        writer = stream.writer;
        writer.write(xmlBuilder.buildHeader());

        if (keys && keys.length) {
            total = keys.length;
            var i;
            for (i = 0; i < keys.length; i++) {
                try {
                    var m = fetcher.fetchByKeyOrId(keys[i]);
                    if (m) {
                        writeMethod(writer, m, stats);
                    } else {
                        stats.failed++;
                        if (stats.errors.length < 5) {
                            stats.errors.push(keys[i] + ': not found in CTP');
                        }
                    }
                } catch (fe) {
                    stats.failed++;
                    if (stats.errors.length < 5) {
                        stats.errors.push(keys[i] + ': ' + (fe.message || String(fe)));
                    }
                }
            }
        } else {
            do {
                var batch = fetcher.fetchBatch(offset, BATCH_SIZE);
                results   = batch.results || [];
                total     = batch.total || 0;

                if (offset === 0 && total > MAX_SINGLE_FILE_ENTRIES) {
                    streamWriter.closeWriter(writer);
                    return {
                        ok:    false,
                        error: 'Too many shipping methods (' + total + ') for a single XML file. '
                            + 'Maximum is ' + MAX_SINGLE_FILE_ENTRIES + '.'
                    };
                }

                var j;
                for (j = 0; j < results.length; j++) {
                    writeMethod(writer, results[j], stats);
                }
                offset += results.length;
            } while (offset < total && results.length > 0);
        }

        writer.write(xmlBuilder.buildFooter());
        streamWriter.closeWriter(writer);
        writer = null;

        if (!stats.built && !stats.failed) {
            return {
                ok:         true,
                singleFile: true,
                total:      total,
                nextOffset: 0,
                done:       true,
                built:      0,
                failed:     0,
                errors:     [],
                impexPath:  impexPath
            };
        }

        var putResult = uploader.uploadLocalFile(resolved);
        if (!putResult.ok) {
            return { ok: false, error: putResult.error };
        }

        return {
            ok:         true,
            singleFile: true,
            total:      total,
            nextOffset: total,
            done:       true,
            built:      stats.built,
            failed:     stats.failed,
            errors:     stats.errors,
            fileName:   resolved,
            runDate:    runDate,
            impexPath:  impexPath
        };
    } catch (e) {
        if (writer) {
            streamWriter.closeWriter(writer);
        }
        return { ok: false, error: e.message || String(e) };
    }
}

function runMultiFileBatch(offset, siteId) {
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

    var upload = uploadBatchXml(methods, offset);
    if (!upload.ok) {
        return { ok: false, error: upload.error };
    }

    var nextOffset = offset + methods.length;
    return {
        ok:         true,
        singleFile: false,
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

function runBatch(offset, siteId, singleFile) {
    if (!siteId) return { ok: false, error: 'siteId is required' };

    var useSingleFile = singleFile !== false;
    if (useSingleFile) {
        if (offset > 0) {
            return {
                ok:         true,
                singleFile: true,
                total:      offset,
                nextOffset: offset,
                done:       true,
                built:      0,
                failed:     0,
                errors:     [],
                impexPath:  fileResolver.getRelativePath(MODULE_KEY)
            };
        }
        return runSingleFile(null);
    }

    return runMultiFileBatch(offset, siteId);
}

function runBatchForKeys(keys, offset, siteId, singleFile) {
    if (!siteId) return { ok: false, error: 'siteId is required' };

    var refs  = keys || [];
    var total = refs.length;
    var useSingleFile = singleFile !== false;

    if (!total) {
        return {
            ok: true, total: 0, nextOffset: 0, done: true,
            built: 0, failed: 0, errors: [],
            impexPath: fileResolver.getRelativePath(MODULE_KEY)
        };
    }

    if (useSingleFile) {
        if (offset > 0) {
            return {
                ok:         true,
                singleFile: true,
                total:      total,
                nextOffset: total,
                done:       true,
                built:      0,
                failed:     0,
                errors:     [],
                impexPath:  fileResolver.getRelativePath(MODULE_KEY)
            };
        }
        return runSingleFile(refs);
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

    var upload = uploadBatchXml(methods, offset);
    if (!upload.ok) {
        return { ok: false, error: upload.error };
    }

    var nextOffset = offset + slice.length;
    return {
        ok:         true,
        singleFile: false,
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
