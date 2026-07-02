'use strict';

var fetcher      = require('*/cartridge/scripts/migration/storeMigration/ctpStoreFetcher');
var transformer  = require('*/cartridge/scripts/migration/storeMigration/storeTransformer');
var xmlBuilder   = require('*/cartridge/scripts/migration/storeMigration/storeXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/storeMigration/webDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var fileNaming   = require('*/cartridge/scripts/migration/storeMigration/storeFileNaming');

var MODULE_KEY = 'store';

/**
 * Single-shot store list export from CTP /stores.
 * @param {number} offset
 * @param {string} exportKey
 * @param {string} [fileName]
 * @param {Array<string>} [keys] - optional selected store refs (CTP key or id)
 * @returns {Object}
 */
function runBatch(offset, exportKey, fileName, keys) {
    if (!exportKey) return { ok: false, error: 'exportKey is required' };

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

    var allStores   = fetcher.fetchAllCtpStores();
    var stores      = fetcher.filterStoresByRefs(allStores, keys);
    var channelById = fetcher.fetchChannelMap();
    var records     = transformer.buildStoreRecords(stores, channelById);
    var total       = records.length;

    if (!total) {
        return {
            ok:    false,
            error: keys && keys.length
                ? 'No matching stores found for the selected items.'
                : 'No commercetools stores found. Create stores in CTP Merchant Center under Stores.'
        };
    }

    var runDate     = fileResolver.getRunDate(MODULE_KEY + '_' + fileNaming.exportKeySafe(exportKey), 0);
    var resolved    = fileNaming.resolveFileName(exportKey, 0, 500, fileName);
    var impexPath   = fileResolver.getRelativePath(MODULE_KEY);
    var buildResult = xmlBuilder.buildXml(records);
    var dirResult   = uploader.ensureDirectory();

    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    var putResult = uploader.uploadFile(resolved, buildResult.xml);
    if (!putResult.ok) {
        return { ok: false, error: 'WebDAV upload failed: ' + putResult.error };
    }

    return {
        ok:         true,
        total:      total,
        nextOffset: total,
        done:       true,
        built:      buildResult.built,
        failed:     buildResult.failed,
        errors:     buildResult.errors,
        fileName:   resolved,
        runDate:    runDate,
        impexPath:  impexPath,
        exportKey:  exportKey
    };
}

module.exports = { runBatch: runBatch };
