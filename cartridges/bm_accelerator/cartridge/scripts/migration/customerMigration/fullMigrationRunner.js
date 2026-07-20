'use strict';

var File         = require('dw/io/File');
var FileWriter   = require('dw/io/FileWriter');
var fetcher      = require('*/cartridge/scripts/migration/customerMigration/ctpCustomerFetcher');
var xmlBuilder   = require('*/cartridge/scripts/migration/customerMigration/customerXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/customerMigration/webDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var sfccClient   = require('*/cartridge/scripts/migration/sfccClient');

var MODULE_KEY               = 'customer';
var FETCH_BATCH_SIZE         = 500;
var MAX_SINGLE_FILE_CUSTOMERS = 20000;

var FULL_CUSTOM_ATTRS = [
    { id: 'ctp_customer_id',     display: 'CTP Customer ID'     },
    { id: 'ctp_customer_number', display: 'CTP Customer Number' },
    { id: 'ctp_external_id',     display: 'CTP External ID'     },
    { id: 'CTCustomerId',        display: 'CT Customer ID'      }
];

var CTP_ATTR_GROUP_ID   = 'CTPMigration';
var CTP_ATTR_GROUP_NAME = 'CTP Migration';

function ensureAttributes() {
    try {
        var token = sfccClient.getSFCCToken();
        try { sfccClient.ensureAttributeGroup(token, 'Profile', CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME); } catch (ge) {}
        for (var i = 0; i < FULL_CUSTOM_ATTRS.length; i++) {
            var a = FULL_CUSTOM_ATTRS[i];
            try {
                sfccClient.createAttributeDefinition(token, 'Profile', {
                    id: a.id, value_type: 'string', mandatory: false,
                    searchable: false, externally_defined: false,
                    externally_managed: false, order_required: false,
                    display_name: { 'default': a.display }
                });
                try { sfccClient.addAttributeToGroup(token, 'Profile', CTP_ATTR_GROUP_ID, a.id); } catch (age) {}
            } catch (e) { /* already exists */ }
        }
    } catch (te) { /* non-fatal */ }
}

function ensureImpexDir(relativePath) {
    var dir = new File(File.IMPEX + File.SEPARATOR + String(relativePath).replace(/\//g, File.SEPARATOR));
    if (!dir.exists()) {
        dir.mkdirs();
    }
    return dir;
}

/**
 * Stream every CTP customer into one IMPEX file without ever holding the
 * full XML in memory as a single string (avoids the api.jsStringLength quota
 * that a read-back-and-concatenate approach hits once a file passes ~1MB).
 * @param {string} listId
 * @returns {Object}
 */
function runSingleFile(listId) {
    ensureAttributes();

    var impexPath = fileResolver.getRelativePath(MODULE_KEY);
    var fileName  = fileResolver.resolveRunFileName(MODULE_KEY, 0, 'webdav');
    var runDate   = fileResolver.getRunDate(MODULE_KEY, 0);
    var dir       = ensureImpexDir(impexPath);
    var outFile   = new File(dir, fileName);
    var writer    = null;
    var built     = 0;
    var failed    = 0;
    var errors    = [];
    var offset    = 0;
    var total     = 0;
    var customers = [];

    try {
        var dirResult = uploader.ensureDirectory();
        if (!dirResult.ok) {
            return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
        }

        writer = new FileWriter(outFile, 'UTF-8');
        writer.write(xmlBuilder.XML_HEADER);

        do {
            var batch = fetcher.fetchBatch(offset, FETCH_BATCH_SIZE);
            customers = batch.results || [];
            total     = batch.total || 0;

            if (offset === 0 && total > MAX_SINGLE_FILE_CUSTOMERS) {
                writer.close();
                return {
                    ok:    false,
                    error: 'Too many customers (' + total + ') for a single XML file. '
                        + 'Maximum is ' + MAX_SINGLE_FILE_CUSTOMERS + '.'
                };
            }

            for (var i = 0; i < customers.length; i++) {
                var fragment = xmlBuilder.buildCustomerFragment([customers[i]]);
                writer.write(fragment.body);
                built  += fragment.built;
                failed += fragment.failed;
                if (fragment.errors.length && errors.length < 5) {
                    errors = errors.concat(fragment.errors.slice(0, 5 - errors.length));
                }
            }

            offset += customers.length;
        } while (offset < total && customers.length > 0);

        writer.write(xmlBuilder.XML_FOOTER);
        writer.close();
        writer = null;

        if (!built && !failed) {
            return {
                ok: true, total: total, nextOffset: 0, done: true,
                built: 0, failed: 0, errors: [], impexPath: impexPath
            };
        }

        var putResult = uploader.uploadLocalFile(fileName);
        if (!putResult.ok) {
            return { ok: false, error: putResult.error };
        }

        return {
            ok:         true,
            total:      total,
            nextOffset: total,
            done:       true,
            built:      built,
            failed:     failed,
            errors:     errors,
            fileName:   fileName,
            runDate:    runDate,
            impexPath:  impexPath
        };
    } catch (e) {
        if (writer) {
            try { writer.close(); } catch (ce) { /* ignore */ }
        }
        return { ok: false, error: e.message || String(e) };
    }
}

/**
 * @param {number} offset - ignored beyond 0/non-0: the whole run completes in a single call
 * @param {string} listId
 * @returns {Object}
 */
function runBatch(offset, listId) {
    if (!listId) return { ok: false, error: 'listId is required' };

    if (offset > 0) {
        return {
            ok: true, total: offset, nextOffset: offset, done: true,
            built: 0, failed: 0, errors: [],
            impexPath: fileResolver.getRelativePath(MODULE_KEY)
        };
    }

    return runSingleFile(listId);
}

module.exports = { runBatch: runBatch };
