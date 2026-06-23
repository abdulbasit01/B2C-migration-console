'use strict';

var fetcher    = require('*/cartridge/scripts/migration/customerMigration/ctpCustomerFetcher');
var xmlBuilder = require('*/cartridge/scripts/migration/customerMigration/customerXmlBuilder');
var uploader   = require('*/cartridge/scripts/migration/customerMigration/webDavUploader');

var BATCH_SIZE = 500;

/**
 * Run one Full Migration batch:
 *   1. Fetch BATCH_SIZE customers from CTP at the given offset
 *   2. Build SFCC customer import XML
 *   3. Ensure WebDAV directory exists
 *   4. Upload XML file to WebDAV
 *
 * File name is deterministic ("customers-<offset>.xml") so re-running with the same
 * offset overwrites the previous file — safe for retry/resume scenarios.
 *
 * @param {number} offset - CTP pagination offset
 * @param {string} listId - SFCC customer list ID (passed through for response symmetry with partial runner)
 * @returns {{ ok, total, nextOffset, done, built, failed, errors }}
 */
function runBatch(offset, listId) {
    if (!listId) return { ok: false, error: 'listId is required' };

    var batch     = fetcher.fetchBatch(offset, BATCH_SIZE);
    var customers = batch.results;
    var total     = batch.total;

    if (!customers || customers.length === 0) {
        return { ok: true, total: total, nextOffset: offset, done: true, built: 0, failed: 0, errors: [] };
    }

    var buildResult = xmlBuilder.buildXml(customers);

    var dirResult = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    // Write config.json on first batch so the job step always targets the correct list,
    // even if the CustomerListID parameter was not set on the job.
    if (offset === 0) {
        uploader.uploadFile('config.json', JSON.stringify({ listId: listId }));
    }

    var fileName   = 'customers-' + offset + '.xml';
    var putResult  = uploader.uploadFile(fileName, buildResult.xml);
    if (!putResult.ok) {
        return { ok: false, error: 'WebDAV upload failed: ' + putResult.error };
    }

    var nextOffset = offset + customers.length;
    return {
        ok:         true,
        total:      total,
        nextOffset: nextOffset,
        done:       nextOffset >= total || customers.length === 0,
        built:      buildResult.built,
        failed:     buildResult.failed,
        errors:     buildResult.errors
    };
}

module.exports = { runBatch: runBatch };
