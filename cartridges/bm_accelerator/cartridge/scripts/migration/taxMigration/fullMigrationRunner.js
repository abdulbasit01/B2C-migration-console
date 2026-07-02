'use strict';

var fetcher      = require('*/cartridge/scripts/migration/taxMigration/ctpTaxFetcher');
var transformer  = require('*/cartridge/scripts/migration/taxMigration/taxTransformer');
var xmlBuilder   = require('*/cartridge/scripts/migration/taxMigration/taxXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/taxMigration/webDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var fileNaming   = require('*/cartridge/scripts/migration/taxMigration/taxFileNaming');

var MODULE_KEY = 'tax';

/**
 * Build filter from scope parameters.
 * @param {string} scopeType
 * @param {string} scopeId
 * @param {string} exportKey
 * @returns {{ type: string, id: string }}
 */
function resolveFilter(scopeType, scopeId, exportKey) {
    if (exportKey === 'full' || scopeType === 'full') {
        return { type: 'full', id: '' };
    }
    if (scopeType === 'country') {
        return { type: 'country', id: scopeId || '' };
    }
    if (scopeType === 'category') {
        return { type: 'category', id: scopeId || '' };
    }
    return { type: 'full', id: '' };
}

/**
 * Single-shot tax export — CTP tax categories are small enough for one XML file.
 * @param {number} offset
 * @param {string} exportKey
 * @param {string} scopeType
 * @param {string} [scopeId]
 * @param {string} [fileName]
 * @returns {Object}
 */
function runBatch(offset, exportKey, scopeType, scopeId, fileName) {
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

    var categories = fetcher.fetchAllTaxCategories();
    var filter     = resolveFilter(scopeType, scopeId, exportKey);
    var model      = transformer.buildTaxModel(categories, filter);
    var total      = model.taxRates.length;

    if (!model.taxClasses.length && !model.taxRates.length) {
        return {
            ok:         true,
            total:      0,
            nextOffset: 0,
            done:       true,
            built:      0,
            failed:     0,
            errors:     [],
            impexPath:  fileResolver.getRelativePath(MODULE_KEY)
        };
    }

    var runDate   = fileResolver.getRunDate(MODULE_KEY + '_' + fileNaming.exportKeySafe(exportKey), 0);
    var resolved  = fileNaming.resolveFileName(exportKey, 0, 500, fileName);
    var impexPath = fileResolver.getRelativePath(MODULE_KEY);
    var buildResult = xmlBuilder.buildXml(model);
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
