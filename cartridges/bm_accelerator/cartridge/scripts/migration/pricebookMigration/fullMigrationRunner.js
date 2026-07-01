'use strict';

var fetcher      = require('*/cartridge/scripts/migration/pricebookMigration/ctpPricebookFetcher');
var embedded     = require('*/cartridge/scripts/migration/pricebookMigration/ctpEmbeddedPriceFetcher');
var transformer  = require('*/cartridge/scripts/migration/pricebookMigration/pricebookTransformer');
var xmlBuilder   = require('*/cartridge/scripts/migration/pricebookMigration/pricebookXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/pricebookMigration/webDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var fileNaming   = require('*/cartridge/scripts/migration/pricebookMigration/pricebookFileNaming');

var MODULE_KEY = 'pricebook';
var BATCH_SIZE = 500;

function uploadBatchXml(records, pricebookId, currency, offset, total, exportKey, channelId, fileName, aggregate, description) {
    if (!records || !records.length) {
        return { ok: true, built: 0, failed: 0, errors: [], fileName: null };
    }

    var runDate   = fileResolver.getRunDate(MODULE_KEY + '_' + fileNaming.exportKeySafe(exportKey), offset);
    var resolved  = fileNaming.resolveFileName(exportKey, offset, BATCH_SIZE, fileName);
    var impexPath = fileResolver.getRelativePath(MODULE_KEY);
    var desc      = description || ('Commercetools standalone-price migration (' + currency + ')');
    if (aggregate) {
        desc += ' — all channels';
    } else if (channelId) {
        desc += ' — channel ' + channelId;
    }

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

/**
 * @param {number} offset
 * @param {string} pricebookId
 * @param {string} currency
 * @param {string} [channelId]
 * @param {string} exportKey
 * @param {string} [fileName]
 * @param {boolean} [aggregate]
 * @returns {Object}
 */
function runBatch(offset, pricebookId, currency, channelId, exportKey, fileName, aggregate) {
    if (!pricebookId) return { ok: false, error: 'pricebookId is required' };
    if (!currency) return { ok: false, error: 'currency is required' };
    if (!exportKey) return { ok: false, error: 'exportKey is required' };

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
        records, pricebookId, currency, offset, total, exportKey, chId || null, fileName, aggregate
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
        exportKey:  exportKey,
        source:     'standalone'
    };
}

/**
 * Export embedded variant prices from CTP products (offset = product offset).
 * @param {number} offset
 * @param {string} pricebookId
 * @param {string} currency
 * @param {string} [channelId]
 * @param {string} exportKey
 * @param {string} [fileName]
 * @param {boolean} [aggregate]
 * @returns {Object}
 */
function runEmbeddedBatch(offset, pricebookId, currency, channelId, exportKey, fileName, aggregate) {
    if (!pricebookId) return { ok: false, error: 'pricebookId is required' };
    if (!currency) return { ok: false, error: 'currency is required' };
    if (!exportKey) return { ok: false, error: 'exportKey is required' };

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

    var desc = 'Commercetools embedded product prices (' + currency + ')';
    if (aggregate) {
        desc += ' — all channels';
    } else if (chId && chId !== 'all') {
        desc += ' — channel ' + chId;
    }

    var upload = uploadBatchXml(
        batch.records, pricebookId, currency, offset, total, exportKey,
        chId === 'all' ? null : chId, fileName, aggregate, desc
    );
    if (!upload.ok) {
        return { ok: false, error: upload.error };
    }

    return {
        ok:         true,
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
