'use strict';

/* global session */

var ctpFetcher   = require('*/cartridge/scripts/migration/productMigration/ctpProductFetcher');
var xmlBuilder   = require('*/cartridge/scripts/migration/productMigration/productXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/productMigration/productWebDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');

var MODULE_KEY = 'product';
var BATCH_SIZE = 500;

// ─── Session keys ─────────────────────────────────────────────────────────────

var SK_TOTAL      = 'migProdTotal';
var SK_BUILT      = 'migProdBuilt';
var SK_FAILED     = 'migProdFailed';
var SK_SETS       = 'migProdSets';
var SK_BUNDLES    = 'migProdBundles';
var SK_FILENAME   = 'migProdFileName';

// Temp file names written to local IMPEX during accumulation
var TEMP_PRODS = 'prod-run-body.xml';
var TEMP_CATS  = 'prod-run-cats.xml';

// ─── Local IMPEX file helpers ─────────────────────────────────────────────────

function getLocalPath(fileName) {
    var File  = require('dw/io/File');
    var paths = require('*/cartridge/scripts/migration/core/migrationPaths');
    return File.IMPEX + File.SEPARATOR
        + paths.getRelativePath(MODULE_KEY).replace(/\//g, File.SEPARATOR)
        + File.SEPARATOR + fileName;
}

function appendLocal(fileName, content) {
    if (!content) return;
    var File       = require('dw/io/File');
    var FileWriter = require('dw/io/FileWriter');
    var f = new File(getLocalPath(fileName));
    var w = new FileWriter(f, 'UTF-8', true); // append=true
    try { w.write(content); } finally { w.close(); }
}

function copyFileTo(srcPath, writer) {
    var File       = require('dw/io/File');
    var FileReader = require('dw/io/FileReader');
    var src = new File(srcPath);
    if (!src.exists()) return;
    var reader = new FileReader(src, 'UTF-8');
    try {
        var line;
        while ((line = reader.readLine()) !== null) {
            writer.write(line);
            writer.write('\n');
        }
    } finally {
        reader.close();
    }
}

function removeLocal(fileName) {
    var File = require('dw/io/File');
    var f    = new File(getLocalPath(fileName));
    if (f.exists()) f.remove();
}

// ─── Session counter helpers ──────────────────────────────────────────────────

function getNum(key) { return parseInt(String(session.custom[key] || 0), 10); }
function addNum(key, n) { session.custom[key] = String(getNum(key) + (n || 0)); }
function setNum(key, n) { session.custom[key] = String(n || 0); }

// ─── CTP single-file batch accumulator ───────────────────────────────────────

/**
 * Run one CTP batch — accumulates products/categories in local IMPEX temp files
 * and uploads a SINGLE XML file only on the final batch.
 *
 * @param {number} offset
 * @param {string} catalogId
 * @param {Array}  selectedVarAttrs
 * @returns {{ ok, total, nextOffset, done, built, failed, errors, setCount, bundleCount }}
 */
function runCtpBatch(offset, catalogId, selectedVarAttrs) {
    var isFirst = (offset === 0);

    if (isFirst) {
        // Clear any leftover temp files and reset all session counters
        removeLocal(TEMP_PRODS);
        removeLocal(TEMP_CATS);
        setNum(SK_TOTAL, 0);
        setNum(SK_BUILT, 0);
        setNum(SK_FAILED, 0);
        setNum(SK_SETS, 0);
        setNum(SK_BUNDLES, 0);
        session.custom[SK_FILENAME] = '';
    }

    var batch    = ctpFetcher.fetchBatch(offset, BATCH_SIZE);
    var rawProds = batch.results;
    var total    = batch.total;

    if (isFirst) {
        setNum(SK_TOTAL, total);
        // Resolve the single target filename for the entire run
        var runDate  = fileResolver.getRunDate(MODULE_KEY, 0);
        var fileName = fileResolver.resolveXmlFileName(MODULE_KEY, 0, BATCH_SIZE, 'webdav');
        session.custom[SK_FILENAME] = fileName;
    } else {
        total = getNum(SK_TOTAL);
    }

    var impexPath = fileResolver.getRelativePath(MODULE_KEY);
    var targetFileName = String(session.custom[SK_FILENAME] || 'product-run.xml');

    if (!rawProds || rawProds.length === 0) {
        // Nothing fetched — finalize immediately
        return finalizeCtp(catalogId, total, 0, impexPath, targetFileName);
    }

    var dirResult = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    // Build batch parts and append to temp files
    var parts = xmlBuilder.buildXmlParts(rawProds, catalogId, selectedVarAttrs);
    appendLocal(TEMP_PRODS, parts.productsXml);
    appendLocal(TEMP_CATS,  parts.categoriesXml);

    // Accumulate counters in session
    addNum(SK_BUILT,   parts.built);
    addNum(SK_FAILED,  parts.failed);
    addNum(SK_SETS,    parts.setCount);
    addNum(SK_BUNDLES, parts.bundleCount);

    var nextOffset = offset + rawProds.length;
    var done       = nextOffset >= total || rawProds.length === 0;

    if (done) {
        return finalizeCtp(catalogId, total, nextOffset, impexPath, targetFileName);
    }

    return {
        ok:          true,
        total:       total,
        nextOffset:  nextOffset,
        done:        false,
        built:       parts.built,
        failed:      parts.failed,
        errors:      parts.errors || [],
        setCount:    parts.setCount,
        bundleCount: parts.bundleCount
    };
}

/**
 * Assemble accumulated temp files into the final XML by piping line-by-line —
 * never loads the full XML into a JS string (avoids api.jsStringLength quota).
 * Writes directly to local IMPEX (same physical location as WebDAV PUT target).
 */
function finalizeCtp(catalogId, total, nextOffset, impexPath, fileName) {
    var File       = require('dw/io/File');
    var FileWriter = require('dw/io/FileWriter');
    var paths      = require('*/cartridge/scripts/migration/core/migrationPaths');

    var relDir    = paths.getRelativePath(MODULE_KEY).replace(/\//g, File.SEPARATOR);
    var dir       = new File(File.IMPEX + File.SEPARATOR + relDir);
    if (!dir.exists()) { dir.mkdirs(); }

    var finalFile = new File(File.IMPEX + File.SEPARATOR + relDir + File.SEPARATOR + fileName);
    var writer    = new FileWriter(finalFile, 'UTF-8', false);
    var writeErr  = null;
    try {
        writer.write(xmlBuilder.xmlHeader(catalogId));
        copyFileTo(getLocalPath(TEMP_PRODS), writer);
        copyFileTo(getLocalPath(TEMP_CATS),  writer);
        writer.write(xmlBuilder.XML_FOOTER);
    } catch (we) {
        writeErr = we;
    } finally {
        writer.close();
    }

    removeLocal(TEMP_PRODS);
    removeLocal(TEMP_CATS);

    if (writeErr) {
        return { ok: false, error: 'Local IMPEX write failed: ' + (writeErr.message || String(writeErr)) };
    }

    var built   = getNum(SK_BUILT);
    var failed  = getNum(SK_FAILED);
    var sets    = getNum(SK_SETS);
    var bundles = getNum(SK_BUNDLES);

    return {
        ok:          true,
        total:       total,
        nextOffset:  nextOffset,
        done:        true,
        built:       built,
        failed:      failed,
        errors:      [],
        setCount:    sets,
        bundleCount: bundles,
        fileName:    fileName,
        impexPath:   impexPath
    };
}

// ─── Shopify batch accumulator ────────────────────────────────────────────────

var SK_SHOPIFY_COUNT = 'shopifyProdBatchCount';
var SK_SHOPIFY_TOTAL = 'shopifyProdTotal';

function runShopifyBatch(cursor, catalogId) {
    var shopifyFetcher     = require('*/cartridge/scripts/migration/productMigration/shopifyProductFetcher');
    var shopifyTransformer = require('*/cartridge/scripts/migration/productMigration/shopifyProductTransformer');

    var isFirst  = (cursor === null);
    var batchNum = isFirst ? 0 : parseInt(String(session.custom[SK_SHOPIFY_COUNT] || 0), 10);

    var total = 0;
    if (isFirst) {
        try { total = shopifyFetcher.getCount(); } catch (ce) {}
        session.custom[SK_SHOPIFY_TOTAL] = String(total);
    } else {
        total = parseInt(String(session.custom[SK_SHOPIFY_TOTAL] || 0), 10);
    }

    var batch    = shopifyFetcher.fetchBatch(cursor, BATCH_SIZE);
    var rawProds = batch.results;

    if (!rawProds || !rawProds.length) {
        return {
            ok: true, total: total, nextOffset: 0, done: true,
            built: 0, failed: 0, errors: [], setCount: 0, bundleCount: 0,
            impexPath: fileResolver.getRelativePath(MODULE_KEY)
        };
    }

    var dirResult = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    var pseudoOffset = batchNum * BATCH_SIZE;
    var runDate      = fileResolver.getRunDate(MODULE_KEY, pseudoOffset);
    var fileName     = fileResolver.resolveXmlFileName(MODULE_KEY, pseudoOffset, BATCH_SIZE, 'webdav');
    var impexPath    = fileResolver.getRelativePath(MODULE_KEY);

    var catalogResult = xmlBuilder.buildXml(rawProds, catalogId, null, shopifyTransformer.transformProduct);
    var putResult     = uploader.uploadFile(fileName, catalogResult.xml);
    if (!putResult.ok) {
        return { ok: false, error: 'WebDAV upload failed: ' + putResult.error };
    }

    session.custom[SK_SHOPIFY_COUNT] = String(batchNum + 1);

    return {
        ok:          true,
        total:       total,
        nextOffset:  batch.hasMore ? batch.nextCursor : 0,
        done:        !batch.hasMore,
        built:       catalogResult.built,
        failed:      catalogResult.failed,
        errors:      catalogResult.errors || [],
        setCount:    catalogResult.setCount    || 0,
        bundleCount: catalogResult.bundleCount || 0,
        fileName:    fileName,
        runDate:     runDate,
        impexPath:   impexPath
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run one migration batch (platform-aware).
 *
 * @param {number|string|null} offsetOrCursor - numeric offset (CTP) or cursor string (Shopify)
 * @param {string} catalogId
 * @param {Array}  selectedVarAttrs           - CTP only; ignored for Shopify
 * @param {string} platform                   - 'shopify' | 'commercetools'
 * @returns {{ ok, total, nextOffset, done, built, failed, errors, setCount, bundleCount }}
 */
function runBatch(offsetOrCursor, catalogId, selectedVarAttrs, platform) {
    if (!catalogId) return { ok: false, error: 'catalogId is required' };

    if (platform === 'shopify') {
        var cursor = (offsetOrCursor === null || offsetOrCursor === 0
            || offsetOrCursor === '0' || offsetOrCursor === '')
            ? null : String(offsetOrCursor);
        return runShopifyBatch(cursor, catalogId);
    }

    var offset = typeof offsetOrCursor === 'number'
        ? offsetOrCursor
        : parseInt(String(offsetOrCursor || 0), 10);
    return runCtpBatch(offset, catalogId, selectedVarAttrs);
}

/**
 * Migrate a single product by ID (platform-aware).
 *
 * @param {string} prodId
 * @param {string} catalogId
 * @param {Array}  selectedVarAttrs
 * @param {string} platform - 'shopify' | 'commercetools'
 * @returns {{ ok, built, failed, errors, setCount, bundleCount }}
 */
function runById(prodId, catalogId, selectedVarAttrs, platform) {
    if (!prodId)    return { ok: false, error: 'prodId is required' };
    if (!catalogId) return { ok: false, error: 'catalogId is required' };

    var product, transformerFn;

    if (platform === 'shopify') {
        var shopifyFetcher     = require('*/cartridge/scripts/migration/productMigration/shopifyProductFetcher');
        var shopifyTransformer = require('*/cartridge/scripts/migration/productMigration/shopifyProductTransformer');
        product       = shopifyFetcher.fetchById(prodId);
        transformerFn = shopifyTransformer.transformProduct;
    } else {
        product       = ctpFetcher.fetchById(prodId);
        transformerFn = null;
    }

    var dirResult = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    var fileName      = fileResolver.resolveXmlFileName(MODULE_KEY, 0, 1, 'webdav');
    var catalogResult = xmlBuilder.buildXml([product], catalogId, selectedVarAttrs, transformerFn);
    var putResult     = uploader.uploadFile(fileName, catalogResult.xml);
    if (!putResult.ok) {
        return { ok: false, error: 'WebDAV upload failed: ' + putResult.error };
    }

    return {
        ok:          true,
        built:       catalogResult.built,
        failed:      catalogResult.failed,
        errors:      catalogResult.errors  || [],
        setCount:    catalogResult.setCount    || 0,
        bundleCount: catalogResult.bundleCount || 0,
        fileName:    fileName,
        impexPath:   fileResolver.getRelativePath(MODULE_KEY)
    };
}

module.exports = { runBatch: runBatch, runById: runById };
