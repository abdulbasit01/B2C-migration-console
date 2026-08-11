'use strict';

var fetcher      = require('*/cartridge/scripts/migration/customerMigration/bcCustomerFetcher');
var transformer  = require('*/cartridge/scripts/migration/customerMigration/bcCustomerTransformer');
var writer       = require('*/cartridge/scripts/migration/customerMigration/sfccCustomerWriter');
var groupWriter  = require('*/cartridge/scripts/migration/customerMigration/sfccCustomerGroupWriter');
var groupFetcher = require('*/cartridge/scripts/migration/customerMigration/bcCustomerGroupFetcher');

/**
 * Assign a just-created customer to their BigCommerce customer group. Non-fatal:
 * groups may not exist yet if the Fetch/Create Groups step hasn't been run.
 * @param {string} customerNo
 * @param {string} bcGroupId
 */
function assignCustomerGroup(customerNo, bcGroupId) {
    if (!bcGroupId) return;
    var groupId = groupFetcher.groupIdForBcGroup(bcGroupId);
    try { groupWriter.assignCustomerToGroups(customerNo, [groupId]); } catch (ge) { /* non-fatal */ }
}

/**
 * Migrate a single customer profile by BigCommerce customer ID.
 * Used by the Partial Migration "selected IDs" mode.
 *
 * @param {string} bcId   - BigCommerce numeric customer ID
 * @param {string} listId - SFCC customer list ID
 * @returns {Object} { ok, created, skipped, failed, errors, mappings }
 */
function runProfileBatchById(bcId, listId) {
    if (!listId) return { ok: false, error: 'listId is required' };
    if (!bcId)   return { ok: false, error: 'bcId is required' };

    var bcCustomer;
    try {
        bcCustomer = fetcher.fetchById(bcId.trim());
    } catch (fe) {
        return { ok: true, created: 0, skipped: 0, failed: 1,
                 errors: [bcId + ': ' + (fe.message || String(fe))], mappings: [] };
    }
    if (!bcCustomer) {
        return { ok: true, created: 0, skipped: 0, failed: 1,
                 errors: [bcId + ': customer not found in BigCommerce'], mappings: [] };
    }

    var transformed;
    try {
        transformed = transformer.transformCustomer(bcCustomer);
    } catch (te) {
        return { ok: true, created: 0, skipped: 0, failed: 1,
                 errors: [(bcCustomer.email || bcId) + ': transform — ' + (te.message || String(te))], mappings: [] };
    }

    var tempPassword = require('*/cartridge/scripts/migration/core/tempPassword').generate();
    var result;
    try {
        result = writer.createCustomer(null, listId, transformed.profile, tempPassword);
    } catch (we) {
        return { ok: true, created: 0, skipped: 0, failed: 1,
                 errors: [(bcCustomer.email || bcId) + ': ' + (we.message || String(we))], mappings: [] };
    }

    if (result.ok) {
        assignCustomerGroup(result.customerNo, transformed.profile.c_bc_customer_group_id);
        return {
            ok: true, created: 1, skipped: 0, failed: 0, errors: [],
            mappings: [{
                ctpId:        bcCustomer.id,
                sfccNo:       result.customerNo,
                ctpAddresses: transformed.addresses
            }]
        };
    }
    if (result.skipped) {
        return { ok: true, created: 0, skipped: 1, failed: 0, errors: [], mappings: [] };
    }
    return { ok: true, created: 0, skipped: 0, failed: 1,
             errors: [(bcCustomer.email || bcId) + ': ' + (result.error || 'unknown')], mappings: [] };
}

module.exports = {
    runProfileBatchById: runProfileBatchById
};
