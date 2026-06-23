'use strict';

/**
 * SFCC Job Step — Import CTP products from catalog XML files in the Impex directory.
 *
 * Setup (one-time in BM):
 *   Administration → Operations → Jobs → New Job
 *   Add step type: bm_accelerator/cartridge/scripts/jobsteps/importCtpProducts
 *   Set CatalogID parameter (or leave blank — Phase 1 writes config.json automatically)
 *   Save the job with a known ID (e.g. "CTP-Product-Import")
 */

var File               = require('dw/io/File');
var FileReader         = require('dw/io/FileReader');
var XMLStreamReader    = require('dw/io/XMLStreamReader');
var XMLStreamConstants = require('dw/io/XMLStreamConstants');
var Status             = require('dw/system/Status');
var Transaction        = require('dw/system/Transaction');
var ProductMgr         = require('dw/catalog/ProductMgr');
var CatalogMgr         = require('dw/catalog/CatalogMgr');
var Logger             = require('dw/system/Logger');

var log = Logger.getLogger('ctp-migration', 'ProductImport');

/**
 * @param {dw.util.HashMap} args
 * @returns {dw.system.Status}
 */
function execute(args) {
    var importDir = (args.ImportDirectory && String(args.ImportDirectory).trim()) || 'ctp-product-migration';
    var catalogId = (args.CatalogID       && String(args.CatalogID).trim())       || null;

    // Read catalogId from config.json written by Phase 1
    var configFile = new File(
        File.IMPEX + File.SEPARATOR + 'src' + File.SEPARATOR + 'instance'
        + File.SEPARATOR + importDir + File.SEPARATOR + 'config.json'
    );
    if (configFile.exists()) {
        var cfr = null;
        try {
            cfr = new FileReader(configFile, 'UTF-8');
            var line = cfr.readLine();
            if (line) {
                var cfgData = JSON.parse(line);
                if (cfgData.catalogId) { catalogId = cfgData.catalogId; }
            }
        } catch (ce) {
            log.warn('Could not read config.json: ' + ce.message);
        } finally {
            if (cfr) { try { cfr.close(); } catch (e) {} }
        }
    }

    if (!catalogId) {
        log.error('CatalogID is not set. Run Phase 1 of the migration tool first, or set it as a job parameter.');
        return new Status(Status.ERROR, 'MISSING_PARAM', 'CatalogID not set');
    }

    var catalog = CatalogMgr.getCatalog(catalogId);
    if (!catalog) {
        log.error('Catalog not found: ' + catalogId);
        return new Status(Status.ERROR, 'NOT_FOUND', 'Catalog not found: ' + catalogId);
    }

    var dir = new File(
        File.IMPEX + File.SEPARATOR + 'src' + File.SEPARATOR + 'instance'
        + File.SEPARATOR + importDir
    );
    if (!dir.exists() || !dir.isDirectory()) {
        log.error('Import directory not found: ' + importDir);
        return new Status(Status.ERROR, 'NOT_FOUND', 'Directory not found: ' + importDir);
    }

    var files        = dir.listFiles();
    var totalCreated = 0;
    var totalUpdated = 0;
    var totalFailed  = 0;

    if (files) {
        var fileCount = (typeof files.size === 'function') ? files.size() : files.length;
        for (var fi = 0; fi < fileCount; fi++) {
            var f    = (typeof files.get === 'function') ? files.get(fi) : files[fi];
            var name = f.getName();
            if (!(/^products-\d+\.xml$/).test(name)) { continue; }

            log.info('Processing: ' + name);
            var result = processXmlFile(f, catalog);
            totalCreated += result.created;
            totalUpdated += result.updated;
            totalFailed  += result.failed;
            log.info('  ' + name + ': ' + result.created + ' created, ' + result.updated + ' updated, ' + result.failed + ' failed');
        }
    }

    var summary = 'Import complete: ' + totalCreated + ' created, ' + totalUpdated + ' updated, ' + totalFailed + ' failed';
    log.info(summary);
    return new Status(Status.OK, 'OK', summary);
}

// ─── XML file processor ───────────────────────────────────────────────────────

function processXmlFile(file, catalog) {
    var created = 0;
    var updated = 0;
    var failed  = 0;
    var fr      = null;
    var xsr     = null;

    try {
        fr  = new FileReader(file, 'UTF-8');
        xsr = new XMLStreamReader(fr);

        var product       = null;
        var inCustomAttrs = false;
        var attrId        = null;
        var textBuf       = '';
        var langBuf       = '';
        var ev, ln, txt;

        while (xsr.hasNext()) {
            ev = xsr.next();

            if (ev === XMLStreamConstants.START_ELEMENT) {
                ln      = xsr.getLocalName();
                textBuf = '';
                langBuf = xsr.getAttributeValue(null, 'xml:lang') || xsr.getAttributeValue('http://www.w3.org/XML/1998/namespace', 'lang') || 'x-default';

                if (ln === 'product') {
                    product = {
                        productId:    xsr.getAttributeValue(null, 'product-id') || '',
                        name:         '',
                        description:  '',
                        onlineFlag:   true,
                        availableFlag: true,
                        searchableFlag: true,
                        customAttrs:  {}
                    };
                    inCustomAttrs = false;
                } else if (ln === 'custom-attributes') {
                    inCustomAttrs = true;
                } else if (ln === 'custom-attribute') {
                    attrId = xsr.getAttributeValue(null, 'attribute-id');
                } else if (ln === 'category-assignment') {
                    // Process inline — no product buffer needed
                    var cpId  = xsr.getAttributeValue(null, 'product-id');
                    var catId = xsr.getAttributeValue(null, 'category-id');
                    if (cpId && catId) {
                        try {
                            var sfccProd = ProductMgr.getProduct(cpId);
                            var sfccCat  = catalog.getCategory(catId);
                            if (sfccProd && sfccCat) {
                                Transaction.wrap(function () { sfccCat.assignProduct(sfccProd); });
                            }
                        } catch (caErr) {
                            log.warn('Category assignment failed ' + cpId + ' → ' + catId + ': ' + caErr.message);
                        }
                    }
                }

            } else if (ev === XMLStreamConstants.END_ELEMENT) {
                ln  = xsr.getLocalName();
                txt = textBuf.trim();

                if (product) {
                    if (ln === 'display-name')    { product.name        = product.name        || txt; }
                    if (ln === 'long-description') { product.description = product.description || txt; }
                    if (ln === 'online-flag')      { product.onlineFlag  = (txt !== 'false'); }
                    if (ln === 'available-flag')   { product.availableFlag = (txt !== 'false'); }
                    if (ln === 'searchable-flag')  { product.searchableFlag = (txt !== 'false'); }

                    if (inCustomAttrs && attrId && ln === 'custom-attribute') {
                        product.customAttrs[attrId] = txt;
                    }
                }

                if (ln === 'custom-attributes') { inCustomAttrs = false; }
                if (ln === 'custom-attribute')  { attrId = null; }

                if (ln === 'product' && product && product.productId) {
                    var res = createOrUpdateProduct(product);
                    if (res === 'created')      { created++; }
                    else if (res === 'updated') { updated++; }
                    else                        { failed++;  }
                    product = null;
                }

                textBuf = '';

            } else if (ev === XMLStreamConstants.CHARACTERS) {
                textBuf += xsr.getText();
            }
        }
    } catch (e) {
        log.error('Error parsing ' + file.getName() + ': ' + (e.message || String(e)));
    } finally {
        if (xsr) { try { xsr.close(); } catch (e) {} }
        if (fr)  { try { fr.close();  } catch (e) {} }
    }

    return { created: created, updated: updated, failed: failed };
}

// ─── Single-product creation / update ────────────────────────────────────────

function createOrUpdateProduct(prod) {
    if (!prod.productId) return 'failed';

    try {
        var isNew     = false;
        var sfccProd  = ProductMgr.getProduct(prod.productId);

        Transaction.begin();

        if (!sfccProd) {
            sfccProd = ProductMgr.createProduct(prod.productId);
            isNew    = true;
        }

        if (!sfccProd) { Transaction.rollback(); return 'failed'; }

        if (prod.name)        { sfccProd.setName(prod.name, 'default'); }
        if (prod.description) { sfccProd.setDescription(prod.description, 'default'); }
        sfccProd.setOnlineFlag(prod.onlineFlag !== false);
        sfccProd.setAvailableFlag(prod.availableFlag !== false);
        sfccProd.setSearchableFlag(prod.searchableFlag !== false);

        // Custom attributes
        try {
            var keys = Object.keys(prod.customAttrs);
            for (var k = 0; k < keys.length; k++) {
                sfccProd.custom[keys[k]] = prod.customAttrs[keys[k]];
            }
        } catch (ce) {}

        Transaction.commit();
        return isNew ? 'created' : 'updated';

    } catch (e) {
        try { Transaction.rollback(); } catch (re) {}
        log.error('Failed to create/update ' + prod.productId + ': ' + (e.message || String(e)));
        return 'failed';
    }
}

module.exports = { execute: execute };
