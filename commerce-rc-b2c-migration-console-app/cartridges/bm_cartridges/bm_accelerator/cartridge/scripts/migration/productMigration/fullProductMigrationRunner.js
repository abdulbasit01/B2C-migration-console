'use strict';

/* global session */

var ctpFetcher   = require('*/cartridge/scripts/migration/productMigration/ctpProductFetcher');
var xmlBuilder   = require('*/cartridge/scripts/migration/productMigration/productXmlBuilder');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var splitUtils   = require('*/cartridge/scripts/migration/productMigration/productSplitUtils');

var MODULE_KEY         = 'product';
// CT product payloads can be large (variants, attributes and expanded references).
// Keep the initial page comfortably below SFCC's 10 MB in-memory HTTP limit;
// ctpProductFetcher will reduce it further when an unusually large page requires it.
var BATCH_SIZE         = 50;
var SHOPIFY_BATCH_SIZE = 10;  // Shopify GraphQL cost limit: 10 × (50+5+5+10) = 700 pts < 1000

var CTP_PREFIX     = 'ctp';
var SHOPIFY_PREFIX = 'shp';
var SAP_PREFIX     = 'sap';
var BC_PREFIX      = 'bc';
var SAP_BATCH_SIZE = 100; // OCC /products/search default page size
var BC_BATCH_SIZE  = 50;  // BigCommerce V3 catalog page size

// ─── Session keys ─────────────────────────────────────────────────────────────

var SK_TOTAL      = 'migProdTotal';
var SK_BUILT      = 'migProdBuilt';
var SK_FAILED     = 'migProdFailed';
var SK_SETS       = 'migProdSets';
var SK_BUNDLES    = 'migProdBundles';
var SK_FILENAME   = 'migProdFileName';
var SK_CTP_LIMIT  = 'migProdCtpPageSize';
var SK_IMAGE_BASE = 'migProdImageBaseUrl';
var SK_PART       = 'migProdPart';
var SK_IN_FILE    = 'migProdInFile';

// Temp file names written to local IMPEX during accumulation
var TEMP_PRODS   = 'prod-run-body.xml';
var TEMP_CATS    = 'prod-run-cats.xml';
var TEMP_CATMAP  = 'prod-run-catmap.tsv';
var TEMP_LOCATTR = 'prod-run-locattrs.tsv';

// ─── Local IMPEX file helpers ─────────────────────────────────────────────────

function getLocalPath(fileName) {
    var File  = require('dw/io/File');
    var paths = require('*/cartridge/scripts/migration/core/migrationPaths');
    return File.IMPEX + File.SEPARATOR
        + paths.getRelativePath(MODULE_KEY).replace(/\//g, File.SEPARATOR)
        + File.SEPARATOR + fileName;
}

/**
 * Create the product migration directory before any temporary or final file is written.
 * @returns {dw.io.File} local IMPEX directory
 */
function ensureLocalDirectory() {
    var File  = require('dw/io/File');
    var paths = require('*/cartridge/scripts/migration/core/migrationPaths');
    var relDir = paths.getRelativePath(MODULE_KEY).replace(/\//g, File.SEPARATOR);
    var dir = new File(File.IMPEX + File.SEPARATOR + relDir);

    if (!dir.exists()) {
        dir.mkdirs();
    }
    if (!dir.exists()) {
        throw new Error('Unable to create local IMPEX directory: ' + relDir);
    }
    return dir;
}

function appendLocal(fileName, content) {
    if (!content) return;
    var File       = require('dw/io/File');
    var FileWriter = require('dw/io/FileWriter');
    ensureLocalDirectory();
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

function localFileLength(fileName) {
    var File = require('dw/io/File');
    var f = new File(getLocalPath(fileName));
    return f.exists() && f.isFile() ? Number(f.length()) : 0;
}

function currentCtpBodyBytes() {
    return localFileLength(TEMP_PRODS) + localFileLength(TEMP_CATS);
}

/**
 * Persist HashMap as uuid[TAB]key lines — never JSON.parse into a JS object (api.jsObjectSize).
 * @param {dw.util.HashMap} hashMap
 */
function persistCategoryMap(hashMap) {
    if (!hashMap || typeof hashMap.keySet !== 'function') return;
    var File       = require('dw/io/File');
    var FileWriter = require('dw/io/FileWriter');
    var f = new File(getLocalPath(TEMP_CATMAP));
    var w = new FileWriter(f, 'UTF-8', false);
    try {
        var it = hashMap.keySet().iterator();
        while (it.hasNext()) {
            var k = it.next();
            w.write(String(k) + '\t' + String(hashMap.get(k) || '') + '\n');
        }
    } finally {
        w.close();
    }
}

/**
 * @returns {dw.util.HashMap|null}
 */
function loadCategoryMapFromTsv() {
    var File       = require('dw/io/File');
    var FileReader = require('dw/io/FileReader');
    var HashMap    = require('dw/util/HashMap');
    var f = new File(getLocalPath(TEMP_CATMAP));
    if (!f.exists()) return null;
    var map = new HashMap();
    var reader = new FileReader(f, 'UTF-8');
    try {
        var line;
        while ((line = reader.readLine()) !== null) {
            var tab = line.indexOf('\t');
            if (tab < 1) continue;
            map.put(line.substring(0, tab), line.substring(tab + 1));
        }
    } finally {
        reader.close();
    }
    return map.size() > 0 ? map : null;
}

function persistLocAttrMap(hashMap) {
    if (!hashMap || typeof hashMap.keySet !== 'function') return;
    var File       = require('dw/io/File');
    var FileWriter = require('dw/io/FileWriter');
    var f = new File(getLocalPath(TEMP_LOCATTR));
    var w = new FileWriter(f, 'UTF-8', false);
    try {
        var it = hashMap.keySet().iterator();
        while (it.hasNext()) {
            var k = it.next();
            var v = hashMap.get(k);
            var flag = (v === true) ? '1' : (v === false) ? '0' : 'x';
            w.write(String(k) + '\t' + flag + '\n');
        }
    } finally {
        w.close();
    }
}

/**
 * id → boolean localizable from live Product attribute definitions.
 * @returns {dw.util.HashMap|null}
 */
function loadLocAttrMapFromTsv() {
    var File       = require('dw/io/File');
    var FileReader = require('dw/io/FileReader');
    var HashMap    = require('dw/util/HashMap');
    var f = new File(getLocalPath(TEMP_LOCATTR));
    if (!f.exists()) return null;
    var map = new HashMap();
    var reader = new FileReader(f, 'UTF-8');
    try {
        var line;
        while ((line = reader.readLine()) !== null) {
            var tab = line.indexOf('\t');
            if (tab < 1) continue;
            var rest = line.substring(tab + 1);
            map.put(line.substring(0, tab), rest === '1' ? true : (rest === '0' ? false : null));
        }
    } finally {
        reader.close();
    }
    return map.size() > 0 ? map : null;
}

var PRODUCT_SYSTEM_LOCALIZABLE = {
    name: true,
    shortDescription: true,
    longDescription: true,
    pageTitle: true,
    pageDescription: true,
    pageKeywords: true,
    pageURL: true,
    storeReceiptName: true
};

function fetchProductLocalizableAttrIds() {
    var cached = loadLocAttrMapFromTsv();
    if (cached) return cached;
    try {
        var sfccClient = require('*/cartridge/scripts/migration/sfccClient');
        var HashMap    = require('dw/util/HashMap');
        var token = sfccClient.getSFCCToken();
        var attrs = sfccClient.getAttributeDefinitions(token, 'Product') || [];
        var map = new HashMap();
        var i;
        var id;
        var loc;
        var sysKeys = Object.keys(PRODUCT_SYSTEM_LOCALIZABLE);
        for (i = 0; i < sysKeys.length; i++) {
            map.put(sysKeys[i], true);
        }
        for (i = 0; i < attrs.length; i++) {
            id = attrs[i] && attrs[i].id;
            if (!id) continue;
            loc = attrs[i].localizable;
            if (loc === true || loc === false) {
                map.put(id, loc);
            } else if (PRODUCT_SYSTEM_LOCALIZABLE[id]) {
                map.put(id, true);
            } else if (!map.containsKey(id)) {
                map.put(id, 'x');
            }
        }
        persistLocAttrMap(map);
        return map;
    } catch (e) {
        return null;
    }
}

function getCtpXmlOpts(catalogId) {
    var opts = { catalogId: catalogId || '' };
    if (session.custom[SK_IMAGE_BASE]) {
        opts.externalImageBaseUrl = String(session.custom[SK_IMAGE_BASE]);
    }
    var cached = loadCategoryMapFromTsv();
    if (cached) {
        opts.categoryIdToSfcc = cached;
    } else {
        try {
            opts.categoryIdToSfcc = ctpFetcher.fetchCategoryIdMap();
            persistCategoryMap(opts.categoryIdToSfcc);
        } catch (e2) { /* transformer expand still supplies keys when present */ }
    }
    var locMap = fetchProductLocalizableAttrIds();
    if (locMap) opts.localizableAttrIds = locMap;
    return opts;
}

// ─── Session counter helpers ──────────────────────────────────────────────────
function getNum(key) { return parseInt(String(session.custom[key] || 0), 10); }
function addNum(key, n) { session.custom[key] = String(getNum(key) + (n || 0)); }
function setNum(key, n) { session.custom[key] = String(n || 0); }

// ─── CT 20k-per-file batch accumulator ──────────────────────────────────────

function getStr(key) { return String(session.custom[key] || ''); }
function setStr(key, value) { session.custom[key] = value == null ? '' : String(value); }

function completedCtpFiles() {
    var files = [];
    var stem = getStr(SK_FILENAME);
    var completedParts = Math.max(0, (getNum(SK_PART) || 1) - 1);
    if (!stem) return files;
    for (var part = 1; part <= completedParts; part++) {
        files.push(splitUtils.buildPartFileName(stem, part));
    }
    return files;
}

function resolveCtpStem() {
    var offset = 0;
    var stem = fileResolver.resolveXmlFileName(MODULE_KEY, offset, BATCH_SIZE, 'local', CTP_PREFIX);
    var File = require('dw/io/File');
    var firstPart = new File(getLocalPath(splitUtils.buildPartFileName(stem, 1)));

    while (firstPart.exists() && firstPart.isFile()) {
        offset += BATCH_SIZE;
        stem = fileResolver.resolveXmlFileName(MODULE_KEY, offset, BATCH_SIZE, 'local', CTP_PREFIX);
        firstPart = new File(getLocalPath(splitUtils.buildPartFileName(stem, 1)));
    }
    return stem;
}

function finalizeCtpPart(catalogId, stem, allowEmpty) {
    if (!getNum(SK_IN_FILE) && !allowEmpty) return '';

    var File       = require('dw/io/File');
    var FileWriter = require('dw/io/FileWriter');
    var part       = getNum(SK_PART) || 1;
    var fileName   = splitUtils.buildPartFileName(stem, part);
    var finalFile  = new File(getLocalPath(fileName));
    var writer     = new FileWriter(finalFile, 'UTF-8', false);
    var writeErr   = null;
    try {
        writer.write(xmlBuilder.xmlHeader(catalogId, getStr(SK_IMAGE_BASE)));
        copyFileTo(getLocalPath(TEMP_PRODS), writer);
        copyFileTo(getLocalPath(TEMP_CATS), writer);
        writer.write(xmlBuilder.XML_FOOTER);
    } catch (e) {
        writeErr = e;
    } finally {
        writer.close();
    }
    if (writeErr) {
        throw new Error('Local IMPEX write failed: ' + (writeErr.message || String(writeErr)));
    }

    removeLocal(TEMP_PRODS);
    removeLocal(TEMP_CATS);
    setNum(SK_PART, part + 1);
    setNum(SK_IN_FILE, 0);
    return fileName;
}

function appendCtpProducts(rawProducts, catalogId, selectedVarAttrs, state) {
    var remaining = rawProducts.slice(0);
    var xmlOpts = getCtpXmlOpts(catalogId);
    var stem = getStr(SK_FILENAME) || 'ctp-product-run.xml';

    while (remaining.length) {
        var capacity = splitUtils.MAX_PER_FILE - getNum(SK_IN_FILE);
        if (capacity < 1) {
            state.completed.push(finalizeCtpPart(catalogId, stem, false));
            capacity = splitUtils.MAX_PER_FILE;
        }

        var group = remaining.splice(0, capacity);
        var parts = xmlBuilder.buildXmlParts(group, catalogId, selectedVarAttrs, null, xmlOpts);
        if (!getStr(SK_IMAGE_BASE) && parts.imageBaseUrl) setStr(SK_IMAGE_BASE, parts.imageBaseUrl);
        appendLocal(TEMP_PRODS, parts.productsXml);
        appendLocal(TEMP_CATS, parts.categoriesXml);
        setNum(SK_IN_FILE, getNum(SK_IN_FILE) + group.length);

        addNum(SK_BUILT, parts.built);
        addNum(SK_FAILED, parts.failed);
        addNum(SK_SETS, parts.setCount);
        addNum(SK_BUNDLES, parts.bundleCount);
        state.built += parts.built;
        state.failed += parts.failed;
        state.setCount += parts.setCount;
        state.bundleCount += parts.bundleCount;
        if (parts.errors && state.errors.length < 10) {
            state.errors = state.errors.concat(parts.errors.slice(0, 10 - state.errors.length));
        }

        if (splitUtils.shouldRotate(getNum(SK_IN_FILE), currentCtpBodyBytes())) {
            state.completed.push(finalizeCtpPart(catalogId, stem, false));
        }
    }
}

function runCtpBatch(offset, catalogId, selectedVarAttrs) {
    var isFirst = offset === 0;
    if (isFirst) {
        removeLocal(TEMP_PRODS);
        removeLocal(TEMP_CATS);
        removeLocal(TEMP_CATMAP);
        removeLocal(TEMP_LOCATTR);
        setNum(SK_TOTAL, 0);
        setNum(SK_BUILT, 0);
        setNum(SK_FAILED, 0);
        setNum(SK_SETS, 0);
        setNum(SK_BUNDLES, 0);
        setNum(SK_CTP_LIMIT, BATCH_SIZE);
        setNum(SK_PART, 1);
        setNum(SK_IN_FILE, 0);
        setStr(SK_FILENAME, '');
        setStr(SK_IMAGE_BASE, '');
    }

    var requestedPageSize = getNum(SK_CTP_LIMIT) || BATCH_SIZE;
    var batch = ctpFetcher.fetchBatch(offset, requestedPageSize);
    if (batch.pageSize && batch.pageSize !== requestedPageSize) setNum(SK_CTP_LIMIT, batch.pageSize);
    var rawProds = batch.results || [];
    var total = batch.total || 0;

    if (isFirst) {
        setNum(SK_TOTAL, total);
        setStr(SK_FILENAME, resolveCtpStem());
    } else {
        total = getNum(SK_TOTAL);
    }

    var state = { built: 0, failed: 0, setCount: 0, bundleCount: 0, errors: [], completed: [] };
    if (rawProds.length) appendCtpProducts(rawProds, catalogId, selectedVarAttrs, state);

    var nextOffset = offset + rawProds.length;
    var done = !rawProds.length || nextOffset >= total;
    if (done) {
        if (getNum(SK_IN_FILE)) {
            state.completed.push(finalizeCtpPart(catalogId, getStr(SK_FILENAME), false));
        } else if (!completedCtpFiles().length) {
            state.completed.push(finalizeCtpPart(catalogId, getStr(SK_FILENAME), true));
        }
        removeLocal(TEMP_CATMAP);
        removeLocal(TEMP_LOCATTR);
    }

    var files = completedCtpFiles();
    return {
        ok:            true,
        total:         total,
        nextOffset:    nextOffset,
        done:          done,
        built:         done ? getNum(SK_BUILT) : state.built,
        failed:        done ? getNum(SK_FAILED) : state.failed,
        errors:        state.errors,
        setCount:      done ? getNum(SK_SETS) : state.setCount,
        bundleCount:   done ? getNum(SK_BUNDLES) : state.bundleCount,
        fileName:      state.completed.length ? state.completed[state.completed.length - 1] : '',
        fileNames:     state.completed,
        files:         files,
        fileCount:     files.length,
        expectedFiles: splitUtils.expectedFileCount(total),
        maxPerFile:    splitUtils.MAX_PER_FILE,
        maxBytesPerFile: splitUtils.MAX_BYTES_PER_FILE,
        impexPath:     fileResolver.getRelativePath(MODULE_KEY)
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

function runShopifyBatch(cursor, catalogId, selectedVarAttrs) {
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

        var fileName = fileResolver.resolveXmlFileName(MODULE_KEY, 0, SHOPIFY_BATCH_SIZE, 'local', SHOPIFY_PREFIX);
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

    var parts = xmlBuilder.buildXmlParts(rawProds, catalogId, selectedVarAttrs, shopifyTransformer.transformProduct);
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

    var relDir = paths.getRelativePath(MODULE_KEY).replace(/\//g, File.SEPARATOR);
    ensureLocalDirectory();

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

// ─── SAP Commerce (OCC) single-file batch accumulator ────────────────────────
// Offset-paged like CT (no cursor), so this mirrors runCtpBatch/finalizeCtp,
// but passes sapProductTransformer.transformProduct into buildXmlParts like Shopify.

var SK_SAP_TOTAL   = 'sapProdTotal';
var SK_SAP_BUILT   = 'sapProdBuilt';
var SK_SAP_FAILED  = 'sapProdFailed';
var SK_SAP_SETS    = 'sapProdSets';
var SK_SAP_BUNDLES = 'sapProdBundles';
var SK_SAP_FILE    = 'sapProdFileName';

var TEMP_SAP_PRODS = 'sap-run-body.xml';
var TEMP_SAP_CATS  = 'sap-run-cats.xml';

/**
 * @param {number} offset
 * @param {string} catalogId
 * @returns {{ ok, total, nextOffset, done, built, failed, errors, setCount, bundleCount }}
 */
function runSapBatch(offset, catalogId) {
    var sapFetcher     = require('*/cartridge/scripts/migration/productMigration/sapProductFetcher');
    var sapTransformer = require('*/cartridge/scripts/migration/productMigration/sapProductTransformer');

    var isFirst = (offset === 0);

    if (isFirst) {
        removeLocal(TEMP_SAP_PRODS);
        removeLocal(TEMP_SAP_CATS);
        setNum(SK_SAP_BUILT,   0);
        setNum(SK_SAP_FAILED,  0);
        setNum(SK_SAP_SETS,    0);
        setNum(SK_SAP_BUNDLES, 0);
        session.custom[SK_SAP_FILE] = '';
    }

    var batch    = sapFetcher.fetchBatch(offset, SAP_BATCH_SIZE);
    var rawProds = batch.results;
    var total    = batch.total;

    if (isFirst) {
        setNum(SK_SAP_TOTAL, total);
        var fileName = fileResolver.resolveXmlFileName(MODULE_KEY, 0, SAP_BATCH_SIZE, 'local', SAP_PREFIX);
        session.custom[SK_SAP_FILE] = fileName;
    } else {
        total = getNum(SK_SAP_TOTAL);
    }

    var impexPath       = fileResolver.getRelativePath(MODULE_KEY);
    var targetFileName  = String(session.custom[SK_SAP_FILE] || 'sap-product-run.xml');

    if (!rawProds || rawProds.length === 0) {
        return finalizeSap(catalogId, total, 0, impexPath, targetFileName);
    }

    var parts = xmlBuilder.buildXmlParts(rawProds, catalogId, null, sapTransformer.transformProduct);
    appendLocal(TEMP_SAP_PRODS, parts.productsXml);
    appendLocal(TEMP_SAP_CATS,  parts.categoriesXml);

    addNum(SK_SAP_BUILT,   parts.built);
    addNum(SK_SAP_FAILED,  parts.failed);
    addNum(SK_SAP_SETS,    parts.setCount);
    addNum(SK_SAP_BUNDLES, parts.bundleCount);

    var nextOffset = offset + rawProds.length;
    var done       = nextOffset >= total || rawProds.length === 0;

    if (done) {
        return finalizeSap(catalogId, total, nextOffset, impexPath, targetFileName);
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

function finalizeSap(catalogId, total, nextOffset, impexPath, fileName) {
    var File       = require('dw/io/File');
    var FileWriter = require('dw/io/FileWriter');
    var paths      = require('*/cartridge/scripts/migration/core/migrationPaths');

    var relDir = paths.getRelativePath(MODULE_KEY).replace(/\//g, File.SEPARATOR);
    ensureLocalDirectory();

    var finalFile = new File(File.IMPEX + File.SEPARATOR + relDir + File.SEPARATOR + fileName);
    var writer    = new FileWriter(finalFile, 'UTF-8', false);
    var writeErr  = null;
    try {
        writer.write(xmlBuilder.xmlHeader(catalogId));
        copyFileTo(getLocalPath(TEMP_SAP_PRODS), writer);
        copyFileTo(getLocalPath(TEMP_SAP_CATS),  writer);
        writer.write(xmlBuilder.XML_FOOTER);
    } catch (we) {
        writeErr = we;
    } finally {
        writer.close();
    }

    removeLocal(TEMP_SAP_PRODS);
    removeLocal(TEMP_SAP_CATS);

    if (writeErr) {
        return { ok: false, error: 'Local IMPEX write failed: ' + (writeErr.message || String(writeErr)) };
    }

    var built   = getNum(SK_SAP_BUILT);
    var failed  = getNum(SK_SAP_FAILED);
    var sets    = getNum(SK_SAP_SETS);
    var bundles = getNum(SK_SAP_BUNDLES);

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

// ─── BigCommerce V3 single-file batch accumulator (offset-paged like SAP) ─────

var SK_BC_TOTAL   = 'bcProdTotal';
var SK_BC_BUILT   = 'bcProdBuilt';
var SK_BC_FAILED  = 'bcProdFailed';
var SK_BC_SETS    = 'bcProdSets';
var SK_BC_BUNDLES = 'bcProdBundles';
var SK_BC_FILE    = 'bcProdFileName';

var TEMP_BC_PRODS = 'bc-run-body.xml';
var TEMP_BC_CATS  = 'bc-run-cats.xml';

/**
 * @param {number} offset
 * @param {string} catalogId
 * @param {Array} selectedVarAttrs
 * @returns {{ ok, total, nextOffset, done, built, failed, errors, setCount, bundleCount }}
 */
function runBcBatch(offset, catalogId, selectedVarAttrs) {
    var bcFetcher     = require('*/cartridge/scripts/migration/productMigration/bcProductFetcher');
    var bcTransformer = require('*/cartridge/scripts/migration/productMigration/bcProductTransformer');

    var isFirst = (offset === 0);

    if (isFirst) {
        removeLocal(TEMP_BC_PRODS);
        removeLocal(TEMP_BC_CATS);
        setNum(SK_BC_BUILT,   0);
        setNum(SK_BC_FAILED,  0);
        setNum(SK_BC_SETS,    0);
        setNum(SK_BC_BUNDLES, 0);
        session.custom[SK_BC_FILE] = '';
    }

    var batch    = bcFetcher.fetchBatch(offset, BC_BATCH_SIZE);
    var rawProds = batch.results;
    var total    = batch.total;

    if (isFirst) {
        setNum(SK_BC_TOTAL, total);
        var fileName = fileResolver.resolveXmlFileName(MODULE_KEY, 0, BC_BATCH_SIZE, 'local', BC_PREFIX);
        session.custom[SK_BC_FILE] = fileName;
    } else {
        total = getNum(SK_BC_TOTAL);
    }

    var impexPath      = fileResolver.getRelativePath(MODULE_KEY);
    var targetFileName = String(session.custom[SK_BC_FILE] || 'bc-product-run.xml');

    if (!rawProds || rawProds.length === 0) {
        return finalizeBc(catalogId, total, 0, impexPath, targetFileName);
    }

    var parts = xmlBuilder.buildXmlParts(rawProds, catalogId, selectedVarAttrs, bcTransformer.transformProduct);
    appendLocal(TEMP_BC_PRODS, parts.productsXml);
    appendLocal(TEMP_BC_CATS,  parts.categoriesXml);

    addNum(SK_BC_BUILT,   parts.built);
    addNum(SK_BC_FAILED,  parts.failed);
    addNum(SK_BC_SETS,    parts.setCount);
    addNum(SK_BC_BUNDLES, parts.bundleCount);

    var nextOffset = offset + rawProds.length;
    var done       = nextOffset >= total || rawProds.length === 0;

    if (done) {
        return finalizeBc(catalogId, total, nextOffset, impexPath, targetFileName);
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

function finalizeBc(catalogId, total, nextOffset, impexPath, fileName) {
    var File       = require('dw/io/File');
    var FileWriter = require('dw/io/FileWriter');
    var paths      = require('*/cartridge/scripts/migration/core/migrationPaths');

    var relDir = paths.getRelativePath(MODULE_KEY).replace(/\//g, File.SEPARATOR);
    ensureLocalDirectory();

    var finalFile = new File(File.IMPEX + File.SEPARATOR + relDir + File.SEPARATOR + fileName);
    var writer    = new FileWriter(finalFile, 'UTF-8', false);
    var writeErr  = null;
    try {
        writer.write(xmlBuilder.xmlHeader(catalogId));
        copyFileTo(getLocalPath(TEMP_BC_PRODS), writer);
        copyFileTo(getLocalPath(TEMP_BC_CATS),  writer);
        writer.write(xmlBuilder.XML_FOOTER);
    } catch (we) {
        writeErr = we;
    } finally {
        writer.close();
    }

    removeLocal(TEMP_BC_PRODS);
    removeLocal(TEMP_BC_CATS);

    if (writeErr) {
        return { ok: false, error: 'Local IMPEX write failed: ' + (writeErr.message || String(writeErr)) };
    }

    var built   = getNum(SK_BC_BUILT);
    var failed  = getNum(SK_BC_FAILED);
    var sets    = getNum(SK_BC_SETS);
    var bundles = getNum(SK_BC_BUNDLES);

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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run one migration batch (platform-aware).
 *
 * @param {number|string|null} offsetOrCursor - numeric offset (CT/SAP/BC) or cursor string (Shopify)
 * @param {string} catalogId
 * @param {Array}  selectedVarAttrs           - selected variant option/attr names (all platforms)
 * @param {string} platform                   - 'shopify' | 'sap' | 'bigcommerce' | 'commercetools'
 * @returns {{ ok, total, nextOffset, done, built, failed, errors, setCount, bundleCount }}
 */
function runBatch(offsetOrCursor, catalogId, selectedVarAttrs, platform) {
    if (!catalogId) return { ok: false, error: 'catalogId is required' };

    if (platform === 'shopify') {
        var cursor = (offsetOrCursor === null || offsetOrCursor === 0
            || offsetOrCursor === '0' || offsetOrCursor === '')
            ? null : String(offsetOrCursor);
        return runShopifyBatch(cursor, catalogId, selectedVarAttrs);
    }

    var offset = typeof offsetOrCursor === 'number'
        ? offsetOrCursor
        : parseInt(String(offsetOrCursor || 0), 10);

    if (platform === 'sap') {
        return runSapBatch(offset, catalogId);
    }

    if (platform === 'bigcommerce') {
        return runBcBatch(offset, catalogId, selectedVarAttrs);
    }

    return runCtpBatch(offset, catalogId, selectedVarAttrs);
}

/**
 * Migrate a single product by ID (platform-aware).
 *
 * @param {string} prodId
 * @param {string} catalogId
 * @param {Array}  selectedVarAttrs
 * @param {string} platform - 'shopify' | 'sap' | 'bigcommerce' | 'commercetools'
 * @returns {{ ok, built, failed, errors, setCount, bundleCount }}
 */
function runById(prodId, catalogId, selectedVarAttrs, platform) {
    if (!prodId)    return { ok: false, error: 'prodId is required' };
    if (!catalogId) return { ok: false, error: 'catalogId is required' };

    var product, transformerFn;
    var prefix = platform === 'shopify' ? SHOPIFY_PREFIX
        : (platform === 'sap' ? SAP_PREFIX
            : (platform === 'bigcommerce' ? BC_PREFIX : CTP_PREFIX));

    if (platform === 'shopify') {
        var shopifyFetcher     = require('*/cartridge/scripts/migration/productMigration/shopifyProductFetcher');
        var shopifyTransformer = require('*/cartridge/scripts/migration/productMigration/shopifyProductTransformer');
        product       = shopifyFetcher.fetchById(prodId);
        transformerFn = shopifyTransformer.transformProduct;
    } else if (platform === 'sap') {
        var sapFetcherOne     = require('*/cartridge/scripts/migration/productMigration/sapProductFetcher');
        var sapTransformerOne = require('*/cartridge/scripts/migration/productMigration/sapProductTransformer');
        product       = sapFetcherOne.fetchById(prodId);
        transformerFn = sapTransformerOne.transformProduct;
    } else if (platform === 'bigcommerce') {
        var bcFetcherOne     = require('*/cartridge/scripts/migration/productMigration/bcProductFetcher');
        var bcTransformerOne = require('*/cartridge/scripts/migration/productMigration/bcProductTransformer');
        product       = bcFetcherOne.fetchById(prodId);
        transformerFn = bcTransformerOne.transformProduct;
    } else {
        product       = ctpFetcher.fetchById(prodId);
        transformerFn = null;
    }

    ensureLocalDirectory();
    var fileName      = fileResolver.resolveXmlFileName(MODULE_KEY, 0, 1, 'local', prefix);
    var catalogResult = xmlBuilder.buildXml([product], catalogId, selectedVarAttrs, transformerFn, getCtpXmlOpts(catalogId));

    var File       = require('dw/io/File');
    var FileWriter = require('dw/io/FileWriter');
    var paths      = require('*/cartridge/scripts/migration/core/migrationPaths');
    var relDir     = paths.getRelativePath(MODULE_KEY).replace(/\//g, File.SEPARATOR);
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
