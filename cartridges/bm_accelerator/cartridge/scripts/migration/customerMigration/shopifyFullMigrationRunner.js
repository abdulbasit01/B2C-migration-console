'use strict';

var File         = require('dw/io/File');
var FileWriter   = require('dw/io/FileWriter');
var fetcher      = require('*/cartridge/scripts/migration/customerMigration/shopifyCustomerFetcher');
var xmlBuilder   = require('*/cartridge/scripts/migration/customerMigration/shopifyCustomerXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/customerMigration/webDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var attrChecker  = require('*/cartridge/scripts/migration/customerMigration/shopifyCustomerAttrChecker');

var MODULE_KEY                = 'customer';
var FETCH_PAGE_SIZE           = 250;
var MAX_SINGLE_FILE_CUSTOMERS = 20000;

function ensureAttributes() {
    try { attrChecker.createAttributes(attrChecker.SHOPIFY_BUILTIN_FIELDS); } catch (te) { /* non-fatal */ }
}

function ensureImpexDir(relativePath) {
    var dir = new File(File.IMPEX + File.SEPARATOR + String(relativePath).replace(/\//g, File.SEPARATOR));
    if (!dir.exists()) {
        dir.mkdirs();
    }
    return dir;
}

/**
 * Stream every Shopify customer into one IMPEX file without ever holding the
 * full XML in memory as a single string (same approach as the CTP customer
 * streaming runner — avoids the api.jsStringLength platform quota).
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
    var count     = 0;
    var pageInfo  = null;
    var customers = [];

    try {
        var dirResult = uploader.ensureDirectory();
        if (!dirResult.ok) {
            return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
        }

        writer = new FileWriter(outFile, 'UTF-8');
        writer.write(xmlBuilder.XML_HEADER);

        do {
            var page  = fetcher.fetchPage(pageInfo, FETCH_PAGE_SIZE);
            customers = page.results || [];
            pageInfo  = page.nextPageInfo;
            count    += customers.length;

            if (count > MAX_SINGLE_FILE_CUSTOMERS) {
                writer.close();
                return {
                    ok:    false,
                    error: 'Too many customers (over ' + MAX_SINGLE_FILE_CUSTOMERS + ') for a single XML file.'
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
        } while (pageInfo && customers.length > 0);

        writer.write(xmlBuilder.XML_FOOTER);
        writer.close();
        writer = null;

        if (!built && !failed) {
            return {
                ok: true, total: count, nextOffset: 0, done: true,
                built: 0, failed: 0, errors: [], impexPath: impexPath
            };
        }

        var putResult = uploader.uploadLocalFile(fileName);
        if (!putResult.ok) {
            return { ok: false, error: putResult.error };
        }

        return {
            ok:         true,
            total:      count,
            nextOffset: count,
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
