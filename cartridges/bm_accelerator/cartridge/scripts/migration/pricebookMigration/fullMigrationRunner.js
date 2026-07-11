'use strict';

var fetcher      = require('*/cartridge/scripts/migration/pricebookMigration/ctpPricebookFetcher');
var embedded     = require('*/cartridge/scripts/migration/pricebookMigration/ctpEmbeddedPriceFetcher');
var transformer  = require('*/cartridge/scripts/migration/pricebookMigration/pricebookTransformer');
var xmlBuilder   = require('*/cartridge/scripts/migration/pricebookMigration/pricebookXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/pricebookMigration/webDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var fileNaming   = require('*/cartridge/scripts/migration/pricebookMigration/pricebookFileNaming');
var streamWriter = require('*/cartridge/scripts/migration/core/impexStreamWriter');

var MODULE_KEY              = 'pricebook';
var BATCH_SIZE              = 500;
var MAX_SINGLE_FILE_ENTRIES = 100000;

function buildDescription(currency, channelId, aggregate, embeddedSource) {
    var desc = embeddedSource
        ? ('Commercetools embedded product prices (' + currency + ')')
        : ('Commercetools standalone-price migration (' + currency + ')');
    if (aggregate) {
        desc += ' — all channels';
    } else if (channelId) {
        desc += ' — channel ' + channelId;
    }
    return desc;
}

function uploadBatchXml(records, pricebookId, currency, offset, exportKey, channelId, fileName, aggregate, description) {
    if (!records || !records.length) {
        return { ok: true, built: 0, failed: 0, errors: [], fileName: null };
    }

    var runDate   = fileResolver.getRunDate(MODULE_KEY + '_' + fileNaming.exportKeySafe(exportKey), offset);
    var resolved  = fileNaming.resolveFileName(exportKey, offset, BATCH_SIZE, fileName);
    var impexPath = fileResolver.getRelativePath(MODULE_KEY);
    var desc      = description || buildDescription(currency, channelId, aggregate, false);

    var buildResult = xmlBuilder.buildXml(records, pricebookId, currency, desc);
    var dirResult   = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    var putResult = uploader.uploadFile(resolved, buildResult.xml);
    if (!putResult.ok) {
        return { ok: false, error: 'WebDAV upload failed: ' + putResult.error };
    }

    return {
        ok:        true,
        built:     buildResult.built,
        failed:    buildResult.failed,
        errors:    buildResult.errors,
        fileName:  resolved,
        runDate:   runDate,
        impexPath: impexPath
    };
}

function writeRecord(writer, rec, stats) {
    try {
        if (!rec || !rec.sku || !rec.amount) {
            stats.failed++;
            return;
        }
        writer.write(xmlBuilder.buildPriceTableXml(rec));
        stats.built++;
    } catch (e) {
        stats.failed++;
        if (stats.errors.length < 5) {
            stats.errors.push((rec.sku || '?') + ': ' + (e.message || String(e)));
        }
    }
}

function runStandaloneSingleFile(pricebookId, currency, channelId, exportKey, fileName, aggregate) {
    var chId      = (channelId && channelId !== 'all') ? channelId : '';
    var impexPath = fileResolver.getRelativePath(MODULE_KEY);
    var resolved  = fileNaming.resolveFileName(exportKey, 0, BATCH_SIZE, fileName);
    var runDate   = fileResolver.getRunDate(MODULE_KEY + '_' + fileNaming.exportKeySafe(exportKey), 0);
    var desc      = buildDescription(currency, chId || null, aggregate, false);
    var writer    = null;
    var stats     = { built: 0, failed: 0, errors: [] };
    var offset    = 0;
    var total     = 0;
    var results   = [];
    var pending   = null;
    var sortField = aggregate ? 'sku' : 'id';

    function flushPending() {
        if (!pending) return;
        writeRecord(writer, pending, stats);
        pending = null;
    }

    try {
        var dirResult = uploader.ensureDirectory();
        if (!dirResult.ok) {
            return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
        }

        var stream = streamWriter.openWriter(impexPath, resolved);
        writer = stream.writer;
        writer.write(xmlBuilder.buildHeader(pricebookId, currency, desc));

        do {
            var batch = fetcher.fetchBatch(offset, BATCH_SIZE, currency, chId, aggregate, sortField);
            results   = batch.results || [];
            total     = batch.total || 0;

            if (offset === 0 && total > MAX_SINGLE_FILE_ENTRIES) {
                streamWriter.closeWriter(writer);
                return {
                    ok:    false,
                    error: 'Too many prices (' + total + ') for a single XML file. '
                        + 'Maximum is ' + MAX_SINGLE_FILE_ENTRIES + '.'
                };
            }

            var i;
            for (i = 0; i < results.length; i++) {
                var rec = transformer.transformEntry(results[i]);
                if (!rec) {
                    stats.failed++;
                    continue;
                }
                if (aggregate) {
                    if (pending && pending.sku === rec.sku) {
                        pending = transformer.mergeRecords(pending, rec);
                    } else {
                        flushPending();
                        pending = rec;
                    }
                } else {
                    writeRecord(writer, rec, stats);
                }
            }
            offset += results.length;
        } while (offset < total && results.length > 0);

        flushPending();
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
                impexPath:  impexPath,
                exportKey:  exportKey,
                source:     'standalone'
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
            impexPath:  impexPath,
            exportKey:  exportKey,
            source:     'standalone'
        };
    } catch (e) {
        if (writer) {
            streamWriter.closeWriter(writer);
        }
        return { ok: false, error: e.message || String(e) };
    }
}

function runEmbeddedSingleFile(pricebookId, currency, channelId, exportKey, fileName, aggregate) {
    var chId      = (channelId && channelId !== 'all') ? channelId : 'all';
    var impexPath = fileResolver.getRelativePath(MODULE_KEY);
    var resolved  = fileNaming.resolveFileName(exportKey, 0, BATCH_SIZE, fileName);
    var runDate   = fileResolver.getRunDate(MODULE_KEY + '_' + fileNaming.exportKeySafe(exportKey), 0);
    var desc      = buildDescription(currency, chId === 'all' ? null : chId, aggregate, true);
    var writer    = null;
    var stats     = { built: 0, failed: 0, errors: [] };
    var offset    = 0;
    var total     = 0;

    try {
        var dirResult = uploader.ensureDirectory();
        if (!dirResult.ok) {
            return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
        }

        var stream = streamWriter.openWriter(impexPath, resolved);
        writer = stream.writer;
        writer.write(xmlBuilder.buildHeader(pricebookId, currency, desc));

        do {
            var batch = embedded.fetchPriceRecordsBatch(offset, BATCH_SIZE, currency, chId, aggregate);
            total     = batch.total || 0;

            if (offset === 0 && total > MAX_SINGLE_FILE_ENTRIES) {
                streamWriter.closeWriter(writer);
                return {
                    ok:    false,
                    error: 'Too many products (' + total + ') for a single embedded pricebook file. '
                        + 'Maximum is ' + MAX_SINGLE_FILE_ENTRIES + '.'
                };
            }

            var rawRecords = batch.records || [];
            var toWrite    = rawRecords;
            if (aggregate && rawRecords.length) {
                var map = {};
                var ri;
                for (ri = 0; ri < rawRecords.length; ri++) {
                    var rr = rawRecords[ri];
                    if (!rr || !rr.sku) continue;
                    if (map[rr.sku]) {
                        if (!rr.hasChannel && map[rr.sku].hasChannel) {
                            map[rr.sku] = rr;
                        }
                    } else {
                        map[rr.sku] = rr;
                    }
                }
                var mapKeys = Object.keys(map);
                toWrite = [];
                for (ri = 0; ri < mapKeys.length; ri++) {
                    toWrite.push(map[mapKeys[ri]]);
                }
            }

            var i;
            for (i = 0; i < toWrite.length; i++) {
                writeRecord(writer, toWrite[i], stats);
            }

            offset = batch.nextOffset;
        } while (!batch.done);

        writer.write(xmlBuilder.buildFooter());
        streamWriter.closeWriter(writer);
        writer = null;

        if (!stats.built && !stats.failed) {
            return {
                ok:         true,
                singleFile: true,
                total:      total,
                nextOffset: offset,
                done:       true,
                built:      0,
                failed:     0,
                errors:     [],
                impexPath:  impexPath,
                exportKey:  exportKey,
                source:     'embedded'
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
            nextOffset: offset,
            done:       true,
            built:      stats.built,
            failed:     stats.failed,
            errors:     stats.errors,
            fileName:   resolved,
            runDate:    runDate,
            impexPath:  impexPath,
            exportKey:  exportKey,
            source:     'embedded'
        };
    } catch (e) {
        if (writer) {
            streamWriter.closeWriter(writer);
        }
        return { ok: false, error: e.message || String(e) };
    }
}

function runBatch(offset, pricebookId, currency, channelId, exportKey, fileName, aggregate, singleFile) {
    if (!pricebookId) return { ok: false, error: 'pricebookId is required' };
    if (!currency) return { ok: false, error: 'currency is required' };
    if (!exportKey) return { ok: false, error: 'exportKey is required' };

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
                impexPath:  fileResolver.getRelativePath(MODULE_KEY),
                exportKey:  exportKey,
                source:     'standalone'
            };
        }
        return runStandaloneSingleFile(pricebookId, currency, channelId, exportKey, fileName, aggregate);
    }

    var chId  = (channelId && channelId !== 'all') ? channelId : '';
    var batch = fetcher.fetchBatch(offset, BATCH_SIZE, currency, chId, aggregate);
    var entries = batch.results;
    var total   = batch.total;

    if (!entries || entries.length === 0) {
        return {
            ok: true, total: total, nextOffset: offset, done: true,
            built: 0, failed: 0, errors: [],
            impexPath: fileResolver.getRelativePath(MODULE_KEY)
        };
    }

    var records = aggregate
        ? transformer.aggregateBySku(entries)
        : entries.map(function (e) { return transformer.transformEntry(e); }).filter(function (r) { return !!r; });

    var upload = uploadBatchXml(
        records, pricebookId, currency, offset, exportKey, chId || null, fileName, aggregate
    );
    if (!upload.ok) {
        return { ok: false, error: upload.error };
    }

    var nextOffset = offset + entries.length;
    return {
        ok:         true,
        singleFile: false,
        total:      total,
        nextOffset: nextOffset,
        done:       nextOffset >= total || entries.length === 0,
        built:      upload.built,
        failed:     upload.failed,
        errors:     upload.errors,
        fileName:   upload.fileName,
        runDate:    upload.runDate,
        impexPath:  upload.impexPath,
        exportKey:  exportKey,
        source:     'standalone'
    };
}

function runEmbeddedBatch(offset, pricebookId, currency, channelId, exportKey, fileName, aggregate, singleFile) {
    if (!pricebookId) return { ok: false, error: 'pricebookId is required' };
    if (!currency) return { ok: false, error: 'currency is required' };
    if (!exportKey) return { ok: false, error: 'exportKey is required' };

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
                impexPath:  fileResolver.getRelativePath(MODULE_KEY),
                source:     'embedded'
            };
        }
        return runEmbeddedSingleFile(pricebookId, currency, channelId, exportKey, fileName, aggregate);
    }

    var chId  = (channelId && channelId !== 'all') ? channelId : 'all';
    var batch = embedded.fetchPriceRecordsBatch(offset, BATCH_SIZE, currency, chId, aggregate);
    var total = batch.total;

    if (!batch.records || !batch.records.length) {
        return {
            ok: true, total: total, nextOffset: batch.nextOffset, done: batch.done,
            built: 0, failed: 0, errors: [],
            impexPath: fileResolver.getRelativePath(MODULE_KEY),
            source: 'embedded'
        };
    }

    var desc = buildDescription(currency, chId === 'all' ? null : chId, aggregate, true);

    var upload = uploadBatchXml(
        batch.records, pricebookId, currency, offset, exportKey,
        chId === 'all' ? null : chId, fileName, aggregate, desc
    );
    if (!upload.ok) {
        return { ok: false, error: upload.error };
    }

    return {
        ok:         true,
        singleFile: false,
        total:      total,
        nextOffset: batch.nextOffset,
        done:       batch.done,
        built:      upload.built,
        failed:     upload.failed,
        errors:     upload.errors,
        fileName:   upload.fileName,
        runDate:    upload.runDate,
        impexPath:  upload.impexPath,
        exportKey:  exportKey,
        source:     'embedded'
    };
}

module.exports = { runBatch: runBatch, runEmbeddedBatch: runEmbeddedBatch };
