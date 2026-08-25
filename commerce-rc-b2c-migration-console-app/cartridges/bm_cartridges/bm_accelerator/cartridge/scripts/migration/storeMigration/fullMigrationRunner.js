'use strict';

var registry     = require('*/cartridge/scripts/migration/core/dataSourceRegistry');
var fetcher      = registry.getFetcher('store');
var transformer  = require('*/cartridge/scripts/migration/storeMigration/storeTransformer');
var xmlBuilder   = require('*/cartridge/scripts/migration/storeMigration/storeXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/storeMigration/webDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var fileNaming   = require('*/cartridge/scripts/migration/storeMigration/storeFileNaming');
var streamWriter = require('*/cartridge/scripts/migration/core/impexStreamWriter');

var MODULE_KEY              = 'store';
var BATCH_SIZE              = 500;
var MAX_SINGLE_FILE_ENTRIES = 10000;

function writeStore(writer, record, stats) {
    try {
        writer.write(xmlBuilder.buildStoreXml(record));
        stats.built++;
    } catch (e) {
        stats.failed++;
        if (stats.errors.length < 5) {
            stats.errors.push((record.storeId || '?') + ': ' + (e.message || String(e)));
        }
    }
}

function buildRefSet(keys) {
    if (!keys || !keys.length) return null;
    var refSet = {};
    var i;
    for (i = 0; i < keys.length; i++) {
        refSet[String(keys[i])] = true;
    }
    return refSet;
}

function runSingleFile(exportKey, fileName, keys) {
    var impexPath  = fileResolver.getRelativePath(MODULE_KEY);
    var resolved   = fileNaming.resolveFileName(exportKey, 0, BATCH_SIZE, fileName);
    var runDate    = fileResolver.getRunDate(MODULE_KEY + '_' + fileNaming.exportKeySafe(exportKey), 0);
    var refSet     = buildRefSet(keys);
    var channelMap = fetcher.fetchChannelMap();
    var writer     = null;
    var stats      = { built: 0, failed: 0, errors: [] };
    var offset     = 0;
    var total      = 0;
    var results    = [];
    var matched    = 0;

    try {
        var dirResult = uploader.ensureDirectory();
        if (!dirResult.ok) {
            return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
        }

        var stream = streamWriter.openWriter(impexPath, resolved);
        writer = stream.writer;
        writer.write(xmlBuilder.buildHeader());

        do {
            var batch = fetcher.fetchBatch(offset, BATCH_SIZE);
            results   = batch.results || [];
            total     = batch.total || 0;

            if (offset === 0 && !refSet && total > MAX_SINGLE_FILE_ENTRIES) {
                streamWriter.closeWriter(writer);
                return {
                    ok:    false,
                    error: 'Too many stores (' + total + ') for a single XML file. '
                        + 'Maximum is ' + MAX_SINGLE_FILE_ENTRIES + '.'
                };
            }

            var i;
            for (i = 0; i < results.length; i++) {
                if (!fetcher.storeMatchesRef(results[i], refSet)) {
                    continue;
                }
                matched++;
                var records = transformer.buildStoreRecords([results[i]], channelMap);
                if (records && records.length) {
                    writeStore(writer, records[0], stats);
                } else {
                    stats.failed++;
                }
            }
            offset += results.length;
        } while (offset < total && results.length > 0);

        writer.write(xmlBuilder.buildFooter());
        streamWriter.closeWriter(writer);
        writer = null;

        var exportTotal = refSet ? matched : total;
        if (!stats.built) {
            return {
                ok:    false,
                error: keys && keys.length
                    ? 'No matching stores found for the selected items.'
                    : 'No commercetools stores found. Create stores in CT Merchant Center under Stores.'
            };
        }

        var putResult = uploader.uploadLocalFile(resolved);
        if (!putResult.ok) {
            return { ok: false, error: putResult.error };
        }

        return {
            ok:         true,
            singleFile: true,
            total:      exportTotal,
            nextOffset: exportTotal,
            done:       true,
            built:      stats.built,
            failed:     stats.failed,
            errors:     stats.errors,
            fileName:   resolved,
            runDate:    runDate,
            impexPath:  impexPath,
            exportKey:  exportKey
        };
    } catch (e) {
        if (writer) {
            streamWriter.closeWriter(writer);
        }
        return { ok: false, error: e.message || String(e) };
    }
}

/**
 * @param {number} offset
 * @param {string} exportKey
 * @param {string} [fileName]
 * @param {Array<string>} [keys]
 * @param {boolean} [singleFile]
 * @returns {Object}
 */
function runBatch(offset, exportKey, fileName, keys, singleFile) {
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
                impexPath:  fileResolver.getRelativePath(MODULE_KEY)
            };
        }
        return runSingleFile(exportKey, fileName, keys);
    }

    if (offset > 0) {
        return {
            ok:         true,
            total:      0,
            nextOffset: offset,
            done:       true,
            built:      0,
            failed:     0,
            errors:     [],
            impexPath:  fileResolver.getRelativePath(MODULE_KEY)
        };
    }

    return runSingleFile(exportKey, fileName, keys);
}

module.exports = { runBatch: runBatch };
