'use strict';

var registry     = require('*/cartridge/scripts/migration/core/dataSourceRegistry');
var fetcher      = registry.getFetcher('shippingMethod');
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
                            stats.errors.push(keys[i] + ': not found in CT');
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

function runMultiFileBatch(offset) {
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

function runByCurrency(keys) {
    var impexPath = fileResolver.getRelativePath(MODULE_KEY);
    var fileName = fileResolver.resolveXmlFileName(MODULE_KEY, 100000, BATCH_SIZE, 'webdav');
    var dateStr = fileName.match(/(\d{8})/)[1];
    var versionStr = fileName.match(/v(\d+)/)[1];

    var dirResult = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    var methodsByCurrency = {};
    var allErrors = [];
    var totalBuilt = 0;
    var totalFailed = 0;
    var uploadedFiles = [];
    var transformer = require('*/cartridge/scripts/migration/shippingMethodMigration/shippingMethodTransformer');

    for (var i = 0; i < keys.length; i++) {
        try {
            var method = fetcher.fetchByKeyOrId(keys[i]);
            if (!method) {
                totalFailed++;
                if (allErrors.length < 5) {
                    allErrors.push(keys[i] + ': not found in CT');
                }
                continue;
            }

            var transformed = transformer.transformShippingMethod(method);
            var variants = transformed.priceVariants || [{ currency: 'USD' }];

            for (var v = 0; v < variants.length; v++) {
                var currency = variants[v].currency || 'USD';
                if (!methodsByCurrency[currency]) {
                    methodsByCurrency[currency] = [];
                }
                methodsByCurrency[currency].push({
                    method: method,
                    currency: currency
                });
            }
        } catch (e) {
            totalFailed++;
            if (allErrors.length < 5) {
                allErrors.push(keys[i] + ': ' + (e.message || String(e)));
            }
        }
    }

    var currencies = Object.keys(methodsByCurrency);

    for (var c = 0; c < currencies.length; c++) {
        var currency = currencies[c];
        var currencyMethodEntries = methodsByCurrency[currency];
        var filteredMethods = [];

        for (var m = 0; m < currencyMethodEntries.length; m++) {
            var entry = currencyMethodEntries[m];
            var originalMethod = entry.method;
            var targetCurrency = entry.currency;

            var methodCopy = JSON.parse(JSON.stringify(originalMethod));
            var zoneRates = methodCopy.zoneRates || [];

            var filteredZoneRates = [];
            for (var zr = 0; zr < zoneRates.length; zr++) {
                var zone = zoneRates[zr];
                var shippingRates = zone.shippingRates || [];
                var filteredRates = [];

                for (var sr = 0; sr < shippingRates.length; sr++) {
                    var shippingRate = shippingRates[sr];
                    var rateCurrency = null;

                    if (shippingRate.price && shippingRate.price.currencyCode) {
                        rateCurrency = shippingRate.price.currencyCode;
                    } else if (shippingRate.tiers && shippingRate.tiers.length && shippingRate.tiers[0].value) {
                        rateCurrency = shippingRate.tiers[0].value.currencyCode;
                    }

                    if (rateCurrency === targetCurrency) {
                        filteredRates.push(shippingRate);
                    }
                }

                if (filteredRates.length > 0) {
                    var filteredZone = JSON.parse(JSON.stringify(zone));
                    filteredZone.shippingRates = filteredRates;
                    filteredZoneRates.push(filteredZone);
                }
            }

            if (filteredZoneRates.length > 0) {
                methodCopy.zoneRates = filteredZoneRates;
                filteredMethods.push(methodCopy);
            }
        }

        if (filteredMethods.length === 0) continue;

        var buildResult = xmlBuilder.buildXml(filteredMethods);
        var fileName = 'shipping-method-' + currency + '-' + dateStr + '-' + versionStr + '.xml';

        var putResult = uploader.uploadFile(fileName, buildResult.xml);

        if (putResult.ok) {
            totalBuilt += buildResult.built;
            totalFailed += buildResult.failed;
            uploadedFiles.push(fileName);
            if (buildResult.errors && buildResult.errors.length) {
                for (var e = 0; e < buildResult.errors.length && allErrors.length < 5; e++) {
                    allErrors.push(buildResult.errors[e]);
                }
            }
        } else {
            totalFailed += filteredMethods.length;
            if (allErrors.length < 5) {
                allErrors.push(currency + ' upload failed: ' + putResult.error);
            }
        }
    }

    return {
        ok:         true,
        singleFile: false,
        total:      keys.length,
        nextOffset: keys.length,
        done:       true,
        built:      totalBuilt,
        failed:     totalFailed,
        errors:     allErrors,
        fileName:   uploadedFiles.join(', '),
        runDate:    dateStr + '-' + versionStr,
        impexPath:  impexPath,
        fileCount:  uploadedFiles.length
    };
}

function runBatch(offset, singleFile) {
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

    return runMultiFileBatch(offset);
}

function runBatchForKeys(keys, offset, singleFile) {
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
                errors.push(slice[i] + ': not found in CT');
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

function runBatchWithExportFormats(keys, offset, exportFormats) {
    if (!exportFormats || !exportFormats.length) {
        return { ok: false, error: 'No export formats selected' };
    }

    try {
        var impexPath = fileResolver.getRelativePath(MODULE_KEY);
        var baseFileName = fileResolver.resolveXmlFileName(MODULE_KEY, 0, BATCH_SIZE, 'webdav');
        var dateMatch = baseFileName.match(/(\d{8})/);
        var versionMatch = baseFileName.match(/v(\d+)/);

        if (!dateMatch || !versionMatch) {
            return { ok: false, error: 'Failed to extract version information' };
        }

        var dateStr = dateMatch[1];
        var versionStr = versionMatch[1];
        var totalBuilt = 0;
        var totalFailed = 0;
        var uploadedFiles = [];
        var allErrors = [];

        for (var f = 0; f < exportFormats.length; f++) {
            var format = exportFormats[f];

            if (format === 'single') {
                try {
                    var singleResult = runBatchForKeys(keys, offset, true);
                    if (singleResult.ok) {
                        totalBuilt += (singleResult.built || 0);
                        totalFailed += (singleResult.failed || 0);
                        if (singleResult.fileName) uploadedFiles.push(singleResult.fileName);
                        if (singleResult.errors) allErrors = allErrors.concat(singleResult.errors);
                    } else {
                        allErrors.push(singleResult.error || 'Single file build failed');
                    }
                } catch (e) {
                    allErrors.push('Single file error: ' + (e.message || String(e)));
                }
            } else if (format.indexOf('currency-') === 0) {
                try {
                    var currency = format.substring('currency-'.length);
                    var currencyResult = buildCurrencyFile(keys, currency, dateStr, versionStr);
                    if (currencyResult.ok) {
                        totalBuilt += (currencyResult.built || 0);
                        totalFailed += (currencyResult.failed || 0);
                        if (currencyResult.fileName) uploadedFiles.push(currencyResult.fileName);
                        if (currencyResult.errors) allErrors = allErrors.concat(currencyResult.errors);
                    } else {
                        allErrors.push(currencyResult.error || ('Currency ' + currency + ' build failed'));
                    }
                } catch (e) {
                    allErrors.push('Currency ' + currency + ' error: ' + (e.message || String(e)));
                }
            }
        }

        return {
            ok:         uploadedFiles.length > 0,
            total:      keys.length,
            nextOffset: keys.length,
            done:       true,
            built:      totalBuilt,
            failed:     totalFailed,
            errors:     allErrors,
            fileName:   uploadedFiles.join(', '),
            runDate:    dateStr + '-' + versionStr,
            impexPath:  impexPath,
            fileCount:  uploadedFiles.length
        };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}

function buildCurrencyFile(keys, currency, dateStr, batchId) {
    var transformer = require('*/cartridge/scripts/migration/shippingMethodMigration/shippingMethodTransformer');
    var impexPath = fileResolver.getRelativePath(MODULE_KEY);

    var filteredMethods = [];
    var totalFailed = 0;
    var allErrors = [];

    for (var i = 0; i < keys.length; i++) {
        try {
            var method = fetcher.fetchByKeyOrId(keys[i]);
            if (!method) {
                totalFailed++;
                if (allErrors.length < 5) {
                    allErrors.push(keys[i] + ': not found in CT');
                }
                continue;
            }

            var transformed = transformer.transformShippingMethod(method);
            var variants = transformed.priceVariants || [{ currency: 'USD' }];
            var methodHasCurrency = false;

            for (var v = 0; v < variants.length; v++) {
                if (variants[v].currency === currency) {
                    methodHasCurrency = true;
                    break;
                }
            }

            if (methodHasCurrency) {
                var methodCopy = JSON.parse(JSON.stringify(method));
                var zoneRates = methodCopy.zoneRates || [];
                var filteredZoneRates = [];

                for (var zr = 0; zr < zoneRates.length; zr++) {
                    var zone = zoneRates[zr];
                    var shippingRates = zone.shippingRates || [];
                    var filteredRates = [];

                    for (var sr = 0; sr < shippingRates.length; sr++) {
                        var shippingRate = shippingRates[sr];
                        var rateCurrency = null;

                        if (shippingRate.price && shippingRate.price.currencyCode) {
                            rateCurrency = shippingRate.price.currencyCode;
                        } else if (shippingRate.tiers && shippingRate.tiers.length && shippingRate.tiers[0].value) {
                            rateCurrency = shippingRate.tiers[0].value.currencyCode;
                        }

                        if (rateCurrency === currency) {
                            filteredRates.push(shippingRate);
                        }
                    }

                    if (filteredRates.length > 0) {
                        var filteredZone = JSON.parse(JSON.stringify(zone));
                        filteredZone.shippingRates = filteredRates;
                        filteredZoneRates.push(filteredZone);
                    }
                }

                if (filteredZoneRates.length > 0) {
                    methodCopy.zoneRates = filteredZoneRates;
                    filteredMethods.push(methodCopy);
                }
            }
        } catch (e) {
            totalFailed++;
            if (allErrors.length < 5) {
                allErrors.push(keys[i] + ': ' + (e.message || String(e)));
            }
        }
    }

    if (filteredMethods.length === 0) {
        return { ok: true, built: 0, failed: totalFailed, errors: allErrors, fileName: null };
    }

    var buildResult = xmlBuilder.buildXml(filteredMethods);
    var fileName = 'shipping-method-' + currency + '-' + dateStr + '-b' + batchId + '.xml';

    var putResult = uploader.uploadFile(fileName, buildResult.xml);
    if (!putResult.ok) {
        return { ok: false, error: 'WebDAV upload failed: ' + putResult.error };
    }

    return {
        ok:       true,
        built:    buildResult.built,
        failed:   buildResult.failed + totalFailed,
        errors:   allErrors.concat(buildResult.errors || []),
        fileName: fileName
    };
}

module.exports = { runBatch: runBatch, runBatchForKeys: runBatchForKeys, runByCurrency: runByCurrency, runBatchWithExportFormats: runBatchWithExportFormats };
