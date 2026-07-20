'use strict';

var fetcher     = require('*/cartridge/scripts/migration/productMigration/ctpProductFetcher');
var transformer = require('*/cartridge/scripts/migration/productMigration/productTransformer');
var sfccClient  = require('*/cartridge/scripts/migration/sfccClient');

var BATCH_SIZE = 50;

function doPut(url, token, payload) {
    return sfccClient.doPut(url, token, payload);
}

function buildPayload(transformed) {
    var payload = {
        id:               transformed.productId,
        online_flag:      true,
        searchable_flag:  true
    };
    if (transformed.name)        { payload.name             = { default: transformed.name }; }
    if (transformed.description) { payload.long_description = { default: transformed.description }; }

    var customAttrs = [];
    if (transformed.ctpId)  { customAttrs.push({ attribute_id: 'ctp_product_id',  c_ctp_product_id:  transformed.ctpId }); }
    if (transformed.ctpKey) { customAttrs.push({ attribute_id: 'ctp_product_key', c_ctp_product_key: transformed.ctpKey }); }
    if (customAttrs.length) { payload.custom_attributes = customAttrs; }

    return payload;
}

/**
 * Migrate one CTP product (master + variants) to SFCC via OCAPI Data API.
 * @returns {{ ok, built, failed, errors }}
 */
function migrateOne(ctpProduct, catalogId, token, apiBase) {
    var transformed;
    try {
        transformed = transformer.transformProduct(ctpProduct);
    } catch (e) {
        return { ok: false, built: 0, failed: 1, errors: ['Transform error: ' + (e.message || String(e))] };
    }

    var built  = 0;
    var failed = 0;
    var errors = [];

    // ── Create / update master product ───────────────────────────────────────
    try {
        var res = doPut(apiBase + '/products/' + encodeURIComponent(transformed.productId), token, buildPayload(transformed));
        if (res.status >= 400) {
            throw new Error('HTTP ' + res.status + ': ' + res.text);
        }
        built++;

        // Assign to catalog root category (non-fatal if it fails)
        try {
            var assignUrl = apiBase + '/catalogs/' + encodeURIComponent(catalogId)
                + '/categories/root/assigned_products/' + encodeURIComponent(transformed.productId);
            doPut(assignUrl, token, { product_id: transformed.productId });
        } catch (ae) { /* non-fatal */ }

    } catch (e) {
        failed++;
        errors.push(transformed.productId + ': ' + (e.message || String(e)));
        return { ok: true, built: built, failed: failed, errors: errors };
    }

    // ── Create / update variant products ─────────────────────────────────────
    for (var vi = 0; vi < transformed.variants.length; vi++) {
        var variant = transformed.variants[vi];
        try {
            var vPayload = {
                id:          variant.productId,
                online_flag: true
            };
            var vRes = doPut(apiBase + '/products/' + encodeURIComponent(variant.productId), token, vPayload);
            if (vRes.status >= 400) {
                throw new Error('HTTP ' + vRes.status);
            }
            built++;
        } catch (ve) {
            failed++;
            errors.push(variant.productId + ': ' + (ve.message || String(ve)));
        }
    }

    return { ok: true, built: built, failed: failed, errors: errors };
}

/**
 * Migrate one batch of CTP products via OCAPI.
 * @param {number} offset
 * @param {string} catalogId
 * @returns {{ ok, total, nextOffset, done, built, failed, errors }}
 */
function migrateBatch(offset, catalogId) {
    var settings = sfccClient.getSFCCSettings();
    var token    = sfccClient.getSFCCToken();
    var apiBase  = settings.baseUrl + '/s/-/dw/data/v24_5';

    var batch   = fetcher.fetchBatch(offset, BATCH_SIZE);
    var results = batch.results;
    var total   = batch.total;

    if (!results || results.length === 0) {
        return { ok: true, total: total, nextOffset: offset, done: true, built: 0, failed: 0, errors: [] };
    }

    var built  = 0;
    var failed = 0;
    var errors = [];

    for (var i = 0; i < results.length; i++) {
        var res = migrateOne(results[i], catalogId, token, apiBase);
        built  += res.built  || 0;
        failed += res.failed || 0;
        if (res.errors && res.errors.length) {
            errors = errors.concat(res.errors);
        }
    }

    var nextOffset = offset + results.length;
    return {
        ok:         true,
        total:      total,
        nextOffset: nextOffset,
        done:       nextOffset >= total,
        built:      built,
        failed:     failed,
        errors:     errors.slice(0, 10)
    };
}

/**
 * Migrate a single CTP product by its UUID via OCAPI.
 * @param {string} ctpId
 * @param {string} catalogId
 * @returns {{ ok, built, failed, errors }}
 */
function migrateById(ctpId, catalogId) {
    var settings = sfccClient.getSFCCSettings();
    var token    = sfccClient.getSFCCToken();
    var apiBase  = settings.baseUrl + '/s/-/dw/data/v24_5';

    var product = fetcher.fetchById(ctpId);
    return migrateOne(product, catalogId, token, apiBase);
}

module.exports = { migrateBatch: migrateBatch, migrateById: migrateById };
