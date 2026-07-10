'use strict';

/* global session */

var ctpFetcher   = require('*/cartridge/scripts/migration/productMigration/ctpProductFetcher');
var xmlBuilder   = require('*/cartridge/scripts/migration/productMigration/productXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/productMigration/productWebDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');

var MODULE_KEY         = 'product';
var BATCH_SIZE         = 500; // CTP batch size
var SHOPIFY_BATCH_SIZE = 10;  // Shopify GraphQL cost limit: 10 × (50+5+5+10) = 700 pts < 1000

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

var SK_SHOPIFY_TOTAL   = 'shopifyProdTotal';
var SK_SHOPIFY_BUILT   = 'shopifyProdBuilt';
var SK_SHOPIFY_FAILED  = 'shopifyProdFailed';
var SK_SHOPIFY_SETS    = 'shopifyProdSets';
var SK_SHOPIFY_BUNDLES = 'shopifyProdBundles';
var SK_SHOPIFY_FILE    = 'shopifyProdFileName';

var TEMP_SHOPIFY_PRODS = 'shopify-run-body.xml';
var TEMP_SHOPIFY_CATS  = 'shopify-run-cats.xml';

function runShopifyBatch(cursor, catalogId) {
    var shopifyFetcher     = require('*/cartridge/scripts/migration/productMigration/shopifyProductFetcher');
    var shopifyTransformer = require('*/cartridge/scripts/migration/productMigration/shopifyProductTransformer');

    var isFirst = (cursor === null);

    if (isFirst) {
        removeLocal(TEMP_SHOPIFY_PRODS);
        removeLocal(TEMP_SHOPIFY_CATS);
        setNum(SK_SHOPIFY_BUILT,   0);
        setNum(SK_SHOPIFY_FAILED,  0);
        setNum(SK_SHOPIFY_SETS,    0);
        setNum(SK_SHOPIFY_BUNDLES, 0);
        session.custom[SK_SHOPIFY_FILE] = '';

        var total = 0;
        try { total = shopifyFetcher.getCount(); } catch (ce) {}
        setNum(SK_SHOPIFY_TOTAL, total);

        var fileName = fileResolver.resolveXmlFileName(MODULE_KEY, 0, SHOPIFY_BATCH_SIZE, 'webdav');
        session.custom[SK_SHOPIFY_FILE] = fileName;
    }

    var total      = getNum(SK_SHOPIFY_TOTAL);
    var impexPath  = fileResolver.getRelativePath(MODULE_KEY);
    var fileName   = String(session.custom[SK_SHOPIFY_FILE] || 'shopify-product-run.xml');

    var batch    = shopifyFetcher.fetchBatch(cursor, SHOPIFY_BATCH_SIZE);
    var rawProds = batch.results;

    if (!rawProds || !rawProds.length) {
        return finalizeShopify(catalogId, total, impexPath, fileName);
    }

    var parts = xmlBuilder.buildXmlParts(rawProds, catalogId, null, shopifyTransformer.transformProduct);
    appendLocal(TEMP_SHOPIFY_PRODS, parts.productsXml);
    appendLocal(TEMP_SHOPIFY_CATS,  parts.categoriesXml);

    addNum(SK_SHOPIFY_BUILT,   parts.built);
    addNum(SK_SHOPIFY_FAILED,  parts.failed);
    addNum(SK_SHOPIFY_SETS,    parts.setCount);
    addNum(SK_SHOPIFY_BUNDLES, parts.bundleCount);

    if (!batch.hasMore) {
        return finalizeShopify(catalogId, total, impexPath, fileName);
    }

    return {
        ok:          true,
        total:       total,
        nextOffset:  batch.nextCursor,
        done:        false,
        built:       parts.built,
        failed:      parts.failed,
        errors:      parts.errors || [],
        setCount:    parts.setCount,
        bundleCount: parts.bundleCount
    };
}

function finalizeShopify(catalogId, total, impexPath, fileName) {
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
        copyFileTo(getLocalPath(TEMP_SHOPIFY_PRODS), writer);
        copyFileTo(getLocalPath(TEMP_SHOPIFY_CATS),  writer);
        writer.write(xmlBuilder.XML_FOOTER);
    } catch (we) {
        writeErr = we;
    } finally {
        writer.close();
    }

    removeLocal(TEMP_SHOPIFY_PRODS);
    removeLocal(TEMP_SHOPIFY_CATS);

    if (writeErr) {
        return { ok: false, error: 'Local IMPEX write failed: ' + (writeErr.message || String(writeErr)) };
    }

    var built   = getNum(SK_SHOPIFY_BUILT);
    var failed  = getNum(SK_SHOPIFY_FAILED);
    var sets    = getNum(SK_SHOPIFY_SETS);
    var bundles = getNum(SK_SHOPIFY_BUNDLES);

    return {
        ok:          true,
        total:       total,
        nextOffset:  0,
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

    var File       = require('dw/io/File');
    var FileWriter = require('dw/io/FileWriter');
    var paths      = require('*/cartridge/scripts/migration/core/migrationPaths');
    var relDir     = paths.getRelativePath(MODULE_KEY).replace(/\//g, File.SEPARATOR);
    var dir        = new File(File.IMPEX + File.SEPARATOR + relDir);
    if (!dir.exists()) { dir.mkdirs(); }
    var singleFile = new File(File.IMPEX + File.SEPARATOR + relDir + File.SEPARATOR + fileName);
    var sw         = new FileWriter(singleFile, 'UTF-8', false);
    try { sw.write(catalogResult.xml); } finally { sw.close(); }

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
