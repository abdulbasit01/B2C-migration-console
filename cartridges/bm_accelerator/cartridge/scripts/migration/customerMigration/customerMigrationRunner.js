'use strict';

var UUIDUtils   = require('dw/util/UUIDUtils');
var fetcher     = require('*/cartridge/scripts/migration/customerMigration/ctpCustomerFetcher');
var transformer = require('*/cartridge/scripts/migration/customerMigration/customerTransformer');
var writer      = require('*/cartridge/scripts/migration/customerMigration/sfccCustomerWriter');
var sfccClient  = require('*/cartridge/scripts/migration/sfccClient');

// ─── CTP traceability attributes ──────────────────────────────────────────────
// These three custom attribute definitions are created on the SFCC Customer
// system object before the first profile batch so that c_ctp_customer_id,
// c_ctp_customer_number, and c_ctp_external_id values written during migration
// are stored correctly rather than silently dropped.

var CTP_CUSTOM_ATTRS = [
    { id: 'ctp_customer_id',     display: 'CTP Customer ID'     },
    { id: 'ctp_customer_number', display: 'CTP Customer Number' },
    { id: 'ctp_external_id',     display: 'CTP External ID'     },
    { id: 'CTCustomerId',        display: 'CT Customer ID'      }
];

var CTP_ATTR_GROUP_ID   = 'CTPMigration';
var CTP_ATTR_GROUP_NAME = 'CTP Migration';

function ensureCtpAttributes(sfccToken) {
    try { sfccClient.ensureAttributeGroup(sfccToken, 'Profile', CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME); } catch (ge) {}
    for (var i = 0; i < CTP_CUSTOM_ATTRS.length; i++) {
        var attr = CTP_CUSTOM_ATTRS[i];
        try {
            sfccClient.createAttributeDefinition(sfccToken, 'Profile', {
                id:                 attr.id,
                value_type:         'string',
                mandatory:          false,
                searchable:         false,
                externally_defined: false,
                externally_managed: false,
                order_required:     false,
                display_name:       { 'default': attr.display }
            });
            try { sfccClient.addAttributeToGroup(sfccToken, 'Profile', CTP_ATTR_GROUP_ID, attr.id); } catch (age) {}
        } catch (e) {
            // Attribute already exists or creation failed — not fatal; migration continues
        }
    }
}

/**
 * Migrate one batch of customer profiles (no addresses — those run separately in phase 2).
 *
 * HTTP budget per call:
 *   1  getSFCCToken
 *   1  CTP auth  (inside fetchBatch)
 *   1  CTP GET /customers  (inside fetchBatch)
 *   1  createCustomer (batch size capped at 1 — CustomerMgr.createCustomer quota is 2/request)
 *   ─────────────────
 *   4  total
 *
 * @param {number} offset - CTP pagination offset
 * @param {string} listId - SFCC customer list ID (e.g. "RefArch")
 * @returns {Object} { ok, total, nextOffset, created, skipped, failed, done, errors, mappings }
 *   mappings: [{ ctpId, sfccNo, ctpAddresses, defaultShippingId }] — used by the address phase
 */
function runProfileBatch(offset, listId) {
    if (!listId) return { ok: false, error: 'listId is required' };

    // First batch only: try to create CTP traceability attr definitions via OCAPI (non-fatal)
    if (offset === 0) {
        try {
            var sfccToken = sfccClient.getSFCCToken();
            ensureCtpAttributes(sfccToken);
        } catch (te) { /* token or attr creation failed — non-fatal, migration continues */ }
    }

    var batch     = fetcher.fetchBatch(offset, 1);      // 1 customer per request — CustomerMgr.createCustomer() quota is 2/request
    var customers = batch.results;
    var total     = batch.total;

    var created  = 0;
    var skipped  = 0;
    var failed   = 0;
    var errors   = [];
    var mappings = [];

    for (var i = 0; i < customers.length; i++) {
        var ctpCustomer = customers[i];
        var transformed;

        try {
            transformed = transformer.transformCustomer(ctpCustomer);
        } catch (te) {
            failed++;
            if (errors.length < 5) {
                errors.push((ctpCustomer.email || ctpCustomer.id) + ': transform — ' + (te.message || String(te)));
            }
            continue;
        }

        // Prefix ensures the password meets common SFCC policies (uppercase, number, special char).
        // The UUID suffix makes it unique and unguessable. Customers must reset via Forgot Password.
        var tempPassword = 'Rc1!' + UUIDUtils.createUUID();
        var result;
        try {
            result = writer.createCustomer(sfccToken, listId, transformed.profile, tempPassword); // 1 call
        } catch (we) {
            failed++;
            if (errors.length < 5) {
                errors.push((ctpCustomer.email || ctpCustomer.id) + ': ' + (we.message || String(we)));
            }
            continue;
        }

        if (result.ok) {
            created++;
            mappings.push({
                ctpId:             ctpCustomer.id,
                sfccNo:            result.customerNo,
                ctpAddresses:      transformed.addresses,
                defaultShippingId: ctpCustomer.defaultShippingAddressId || null
            });
        } else if (result.skipped) {
            skipped++;
        } else {
            failed++;
            if (errors.length < 5) {
                errors.push((ctpCustomer.email || ctpCustomer.id) + ': ' + (result.error || 'unknown'));
            }
        }
    }

    var nextOffset = offset + customers.length;
    return {
        ok:         true,
        total:      total,
        nextOffset: nextOffset,
        created:    created,
        skipped:    skipped,
        failed:     failed,
        done:       nextOffset >= total || customers.length === 0,
        errors:     errors,
        mappings:   mappings
    };
}

/**
 * Migrate one batch of addresses for a single already-created customer.
 *
 * HTTP budget per call:
 *   1  getSFCCToken
 *   10 createAddress (max batch size)
 *   ─────────────────
 *   11 total
 *
 * @param {string} sfccCustomerNo - SFCC customer_no returned by runProfileBatch
 * @param {Array}  ctpAddresses   - pre-transformed SFCC address objects from customerTransformer
 * @param {string} listId         - SFCC customer list ID
 * @param {number} offset         - address array slice offset (for pagination within one customer)
 * @returns {Object} { ok, total, nextOffset, created, failed, done, errors }
 */
function runAddressBatch(sfccCustomerNo, ctpAddresses, listId, offset) {
    if (!listId)         return { ok: false, error: 'listId is required' };
    if (!sfccCustomerNo) return { ok: false, error: 'sfccCustomerNo is required' };

    var addresses  = ctpAddresses || [];
    var start      = offset || 0;
    var batch      = addresses.slice(start, start + 10);
    var created    = 0;
    var failed     = 0;
    var errors     = [];

    for (var i = 0; i < batch.length; i++) {
        var result = writer.createAddress(null, listId, sfccCustomerNo, batch[i]);
        if (result.ok) {
            created++;
        } else {
            failed++;
            if (errors.length < 3) {
                errors.push((batch[i].address_id || i) + ': ' + (result.error || 'unknown'));
            }
        }
    }

    var nextOffset = start + batch.length;
    return {
        ok:         true,
        total:      addresses.length,
        nextOffset: nextOffset,
        created:    created,
        failed:     failed,
        done:       nextOffset >= addresses.length || batch.length === 0,
        errors:     errors
    };
}

/**
 * Migrate a single customer profile by CTP customer ID.
 * Used by the Partial Migration "selected IDs" mode.
 *
 * @param {string} ctpId  - CTP customer UUID
 * @param {string} listId - SFCC customer list ID
 * @returns {Object} { ok, created, skipped, failed, errors, mappings }
 */
function runProfileBatchById(ctpId, listId) {
    if (!listId) return { ok: false, error: 'listId is required' };
    if (!ctpId)  return { ok: false, error: 'ctpId is required' };

    var ctpCustomer;
    try {
        ctpCustomer = fetcher.fetchById(ctpId.trim());
    } catch (fe) {
        return { ok: true, created: 0, skipped: 0, failed: 1,
                 errors: [ctpId + ': ' + (fe.message || String(fe))], mappings: [] };
    }
    if (!ctpCustomer) {
        return { ok: true, created: 0, skipped: 0, failed: 1,
                 errors: [ctpId + ': customer not found in CTP'], mappings: [] };
    }

    var transformed;
    try {
        transformed = transformer.transformCustomer(ctpCustomer);
    } catch (te) {
        return { ok: true, created: 0, skipped: 0, failed: 1,
                 errors: [(ctpCustomer.email || ctpId) + ': transform — ' + (te.message || String(te))], mappings: [] };
    }

    var tempPassword = 'Rc1!' + UUIDUtils.createUUID();
    var result;
    try {
        result = writer.createCustomer(null, listId, transformed.profile, tempPassword);
    } catch (we) {
        return { ok: true, created: 0, skipped: 0, failed: 1,
                 errors: [(ctpCustomer.email || ctpId) + ': ' + (we.message || String(we))], mappings: [] };
    }

    if (result.ok) {
        return {
            ok: true, created: 1, skipped: 0, failed: 0, errors: [],
            mappings: [{
                ctpId:             ctpCustomer.id,
                sfccNo:            result.customerNo,
                ctpAddresses:      transformed.addresses,
                defaultShippingId: ctpCustomer.defaultShippingAddressId || null
            }]
        };
    }
    if (result.skipped) {
        return { ok: true, created: 0, skipped: 1, failed: 0, errors: [], mappings: [] };
    }
    return { ok: true, created: 0, skipped: 0, failed: 1,
             errors: [(ctpCustomer.email || ctpId) + ': ' + (result.error || 'unknown')], mappings: [] };
}

module.exports = {
    runProfileBatch:     runProfileBatch,
    runProfileBatchById: runProfileBatchById,
    runAddressBatch:     runAddressBatch
};
