'use strict';

var fetcher          = require('*/cartridge/scripts/migration/productMigration/ctpProductFetcher');
var xmlBuilder       = require('*/cartridge/scripts/migration/productMigration/productXmlBuilder');
var priceXmlBuilder  = require('*/cartridge/scripts/migration/productMigration/priceBookXmlBuilder');
var invFetcher       = require('*/cartridge/scripts/migration/productMigration/ctpInventoryFetcher');
var invXmlBuilder    = require('*/cartridge/scripts/migration/productMigration/inventoryXmlBuilder');
var transformer      = require('*/cartridge/scripts/migration/productMigration/productTransformer');
var uploader         = require('*/cartridge/scripts/migration/productMigration/productWebDavUploader');

var BATCH_SIZE = 500;

/**
 * Run one migration batch — fetches BATCH_SIZE products from CTP and produces:
 *   - products-<offset>.xml   (catalog XML)
 *   - pricebook-<offset>.xml  (pricebook XML — skipped if no prices found)
 *   - inventory-<offset>.xml  (inventory XML — skipped if no inventory found)
 *
 * Config (offset=0 only): uploads config.json with catalogId, pricebookId, currency, inventoryListId.
 *
 * @param {number} offset          - CTP pagination offset
 * @param {string} catalogId       - target SFCC catalog ID
 * @param {string} pricebookId     - target SFCC pricebook ID      (default: "list-prices")
 * @param {string} currency        - ISO currency code              (default: "USD")
 * @param {string} inventoryListId - target SFCC inventory list ID  (default: "default-inventory")
 * @returns {{ ok, total, nextOffset, done, built, failed, pricesBuilt, inventoryBuilt, errors }}
 */
function runBatch(offset, catalogId, pricebookId, currency, inventoryListId) {
    if (!catalogId) return { ok: false, error: 'catalogId is required' };

    var pbId  = pricebookId     || 'list-prices';
    var cur   = currency        || 'USD';
    var invId = inventoryListId || 'default-inventory';

    // ── 1. Fetch products ─────────────────────────────────────────────────────
    var batch    = fetcher.fetchBatch(offset, BATCH_SIZE);
    var rawProds = batch.results;
    var total    = batch.total;

    if (!rawProds || rawProds.length === 0) {
        return { ok: true, total: total, nextOffset: offset, done: true, built: 0, failed: 0, pricesBuilt: 0, inventoryBuilt: 0, errors: [] };
    }

    // ── 2. Transform (for pricebook + SKU collection) ────────────────────────
    // catalogXmlBuilder does its own internal transform of rawProds for catalog XML;
    // we transform here separately so priceBookXmlBuilder can reuse the result.
    var transformed = [];
    for (var ti = 0; ti < rawProds.length; ti++) {
        try {
            transformed.push(transformer.transformProduct(rawProds[ti]));
        } catch (e) {
            // ignore — catalogResult.failed will capture the same failure
        }
    }

    // ── 3. Collect all SKUs for inventory lookup ───────────────────────────────
    var skus = [];
    for (var si = 0; si < transformed.length; si++) {
        var variants = transformed[si].variants || [];
        for (var vi = 0; vi < variants.length; vi++) {
            if (variants[vi].sku) skus.push(variants[vi].sku);
        }
    }

    // ── 4. Ensure WebDAV directory + write config on first batch ──────────────
    var dirResult = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    if (offset === 0) {
        uploader.uploadFile('config.json', JSON.stringify({
            catalogId:       catalogId,
            pricebookId:     pbId,
            currency:        cur,
            inventoryListId: invId
        }));
    }

    // ── 5. Build + upload catalog XML ─────────────────────────────────────────
    var catalogResult = xmlBuilder.buildXml(rawProds, catalogId);
    var catalogPut    = uploader.uploadFile('products-' + offset + '.xml', catalogResult.xml);
    if (!catalogPut.ok) {
        return { ok: false, error: 'WebDAV upload failed (catalog): ' + catalogPut.error };
    }

    // ── 6. Build + upload pricebook XML ───────────────────────────────────────
    var priceResult = priceXmlBuilder.buildXml(transformed, pbId, cur);
    var pricesBuilt = 0;
    if (priceResult.built > 0) {
        uploader.uploadFile('pricebook-' + offset + '.xml', priceResult.xml);
        pricesBuilt = priceResult.built;
    }

    // ── 7. Fetch inventory + build + upload inventory XML ─────────────────────
    var inventoryBuilt = 0;
    var extraErrors    = [];
    try {
        var invEntries = invFetcher.fetchForSkus(skus);
        if (invEntries.length > 0) {
            var invResult = invXmlBuilder.buildXml(invEntries, invId);
            if (invResult.built > 0) {
                uploader.uploadFile('inventory-' + offset + '.xml', invResult.xml);
                inventoryBuilt = invResult.built;
            }
        }
    } catch (invErr) {
        extraErrors.push('Inventory fetch error: ' + (invErr.message || String(invErr)));
    }

    var nextOffset = offset + rawProds.length;
    return {
        ok:             true,
        total:          total,
        nextOffset:     nextOffset,
        done:           nextOffset >= total || rawProds.length === 0,
        built:          catalogResult.built,
        failed:         catalogResult.failed,
        pricesBuilt:    pricesBuilt,
        inventoryBuilt: inventoryBuilt,
        errors:         (catalogResult.errors || []).concat(extraErrors)
    };
}

module.exports = { runBatch: runBatch };
