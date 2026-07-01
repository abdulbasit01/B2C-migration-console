'use strict';

var fetcher      = require('*/cartridge/scripts/migration/inventoryMigration/ctpInventoryFetcher');
var transformer  = require('*/cartridge/scripts/migration/inventoryMigration/inventoryTransformer');
var xmlBuilder   = require('*/cartridge/scripts/migration/inventoryMigration/inventoryXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/inventoryMigration/webDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var fileNaming   = require('*/cartridge/scripts/migration/inventoryMigration/inventoryFileNaming');

var MODULE_KEY = 'inventory';
var BATCH_SIZE = 500;

/**
 * @param {Array} records
 * @param {string} listId
 * @param {number} offset
 * @param {number} total
 * @param {string} exportKey
 * @param {string} supplyChannelId
 * @param {string} fileName
 * @param {boolean} aggregate
 * @returns {Object}
 */
function uploadBatchXml(records, listId, offset, total, exportKey, supplyChannelId, fileName, aggregate) {
    if (!records || !records.length) {
        return { ok: true, built: 0, failed: 0, errors: [], fileName: null };
    }

    var runDate   = fileResolver.getRunDate(MODULE_KEY + '_' + fileNaming.exportKeySafe(exportKey), offset);
    var resolved  = fileNaming.resolveFileName(exportKey, offset, BATCH_SIZE, fileName);
    var impexPath = fileResolver.getRelativePath(MODULE_KEY);
    var desc      = 'Commercetools inventory migration';
    if (exportKey === 'aggregated') {
        desc += ' (aggregated all channels)';
    } else if (supplyChannelId) {
        desc += ' (supply channel ' + supplyChannelId + ')';
    }

    var buildResult = xmlBuilder.buildXml(records, listId, desc);
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

/**
 * Paginated inventory export from CTP to SFCC inventory-list XML.
 * @param {number} offset
 * @param {string} listId
 * @param {string} [supplyChannelId] - empty or 'all' for aggregated fetch
 * @param {string} [exportKey] - identifies export target (aggregated or channel)
 * @param {string} [fileName] - user-editable XML file name
 * @param {boolean} [aggregate] - sum SKUs across channels when true
 * @returns {Object}
 */
function runBatch(offset, listId, supplyChannelId, exportKey, fileName, aggregate) {
    if (!listId) return { ok: false, error: 'listId is required' };
    if (!exportKey) return { ok: false, error: 'exportKey is required' };

    var channelId = (supplyChannelId && supplyChannelId !== 'all') ? supplyChannelId : '';
    var batch     = fetcher.fetchBatch(offset, BATCH_SIZE, channelId);
    var entries   = batch.results;
    var total     = batch.total;

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
        records, listId, offset, total, exportKey, channelId || null, fileName, aggregate
    );
    if (!upload.ok) {
        return { ok: false, error: upload.error };
    }

    var nextOffset = offset + entries.length;
    return {
        ok:         true,
        total:      total,
        nextOffset: nextOffset,
        done:       nextOffset >= total || entries.length === 0,
        built:      upload.built,
        failed:     upload.failed,
        errors:     upload.errors,
        fileName:   upload.fileName,
        runDate:    upload.runDate,
        impexPath:  upload.impexPath,
        exportKey:  exportKey
    };
}

module.exports = { runBatch: runBatch };
