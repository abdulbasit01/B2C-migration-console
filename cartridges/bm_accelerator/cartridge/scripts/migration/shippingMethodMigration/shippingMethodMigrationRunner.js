'use strict';

var fetcher     = require('*/cartridge/scripts/migration/shippingMethodMigration/ctpShippingMethodFetcher');
var transformer = require('*/cartridge/scripts/migration/shippingMethodMigration/shippingMethodTransformer');
var writer      = require('*/cartridge/scripts/migration/shippingMethodMigration/sfccShippingMethodWriter');
/**
 * Migrate one shipping method by CT key or UUID.
 * @param {string} ctpKeyOrId
 * @param {string} siteId
 * @returns {Object}
 */
function runByKeyOrId(ctpKeyOrId, siteId) {
    if (!siteId) return { ok: false, error: 'siteId is required' };
    if (!ctpKeyOrId) return { ok: false, error: 'ctpKeyOrId is required' };

    var ctpMethod;
    try {
        ctpMethod = fetcher.fetchByKeyOrId(ctpKeyOrId.trim());
    } catch (fe) {
        return { ok: true, created: 0, skipped: 0, failed: 1,
            errors: [ctpKeyOrId + ': ' + (fe.message || String(fe))] };
    }
    if (!ctpMethod) {
        return { ok: true, created: 0, skipped: 0, failed: 1,
            errors: [ctpKeyOrId + ': shipping method not found in CT'] };
    }

    var method;
    try {
        method = transformer.transformShippingMethod(ctpMethod);
    } catch (te) {
        return { ok: true, created: 0, skipped: 0, failed: 1,
            errors: [(ctpMethod.key || ctpKeyOrId) + ': transform — ' + (te.message || String(te))] };
    }

    var result;
    try {
        result = writer.createShippingMethod(null, siteId, method);
    } catch (we) {
        return { ok: true, created: 0, skipped: 0, failed: 1,
            errors: [(method.method_id || ctpKeyOrId) + ': ' + (we.message || String(we))] };
    }

    if (result.ok) {
        return { ok: true, created: 1, skipped: 0, failed: 0, errors: [] };
    }
    if (result.skipped) {
        return { ok: true, created: 0, skipped: 1, failed: 0, errors: [] };
    }
    return { ok: true, created: 0, skipped: 0, failed: 1,
        errors: [(method.method_id || ctpKeyOrId) + ': ' + (result.error || 'unknown')] };
}

/**
 * Migrate one batch of shipping methods (offset pagination).
 * @param {number} offset
 * @param {string} siteId
 * @returns {Object}
 */
function runBatch(offset, siteId) {
    if (!siteId) return { ok: false, error: 'siteId is required' };

    var batch  = fetcher.fetchBatch(offset, 1);
    var methods = batch.results;
    var total   = batch.total;
    var created = 0;
    var skipped = 0;
    var failed  = 0;
    var errors  = [];

    for (var i = 0; i < methods.length; i++) {
        var ctpMethod = methods[i];
        var method;
        try {
            method = transformer.transformShippingMethod(ctpMethod);
        } catch (te) {
            failed++;
            if (errors.length < 5) {
                errors.push((ctpMethod.key || ctpMethod.id) + ': transform — ' + (te.message || String(te)));
            }
            continue;
        }

        var result = writer.createShippingMethod(null, siteId, method);
        if (result.ok) {
            created++;
        } else if (result.skipped) {
            skipped++;
        } else {
            failed++;
            if (errors.length < 5) {
                errors.push((method.method_id || ctpMethod.id) + ': ' + (result.error || 'unknown'));
            }
        }
    }

    var nextOffset = offset + methods.length;
    return {
        ok:         true,
        total:      total,
        nextOffset: nextOffset,
        created:    created,
        skipped:    skipped,
        failed:     failed,
        done:       nextOffset >= total || methods.length === 0,
        errors:     errors
    };
}

module.exports = {
    runByKeyOrId: runByKeyOrId,
    runBatch:     runBatch
};
