'use strict';

/**
 * Create an SFCC customer group if it does not already exist via OCAPI Data API.
 */

function ensureGroup(groupId, groupName) {
    try {
        var sfccClient = require('*/cartridge/scripts/migration/sfccClient');
        var Site       = require('dw/system/Site');

        var token    = sfccClient.getSFCCToken();
        var settings = sfccClient.getSFCCSettings();
        var siteId   = Site.getCurrent().getID();
        var url      = settings.baseUrl
            + '/s/-/dw/data/' + settings.metaVersion
            + '/sites/' + encodeURIComponent(siteId)
            + '/customer_groups/' + encodeURIComponent(groupId)
            + '?client_id=' + encodeURIComponent(settings.bmClientId);

        var getRes = sfccClient.doGet(url, token);
        if (getRes.status === 200) {
            return { ok: true, created: false, error: null };
        }

        var putRes = sfccClient.doPut(url, token, { description: groupName || groupId, type: 'static' });
        var status = putRes.status;
        if (status === 200 || status === 201) {
            return { ok: true, created: true, error: null };
        }
        if (status === 409) {
            return { ok: true, created: false, error: null };
        }
        return { ok: false, created: false, error: 'OCAPI returned ' + status };
    } catch (e) {
        return { ok: false, created: false, error: e.message || String(e) };
    }
}

/**
 * Assign an SFCC customer to a customer group via the OCAPI Data API.
 */
function assignCustomerToGroup(customerNo, groupId, siteId) {
    try {
        var sfccClient = require('*/cartridge/scripts/migration/sfccClient');
        var Site       = require('dw/system/Site');
        var token      = sfccClient.getSFCCToken();
        var settings   = sfccClient.getSFCCSettings();
        var resolvedSiteId = siteId || Site.getCurrent().getID();

        var url = settings.baseUrl
            + '/s/-/dw/data/' + settings.metaVersion
            + '/sites/' + encodeURIComponent(resolvedSiteId)
            + '/customer_groups/' + encodeURIComponent(groupId)
            + '/members/' + encodeURIComponent(customerNo)
            + '?client_id=' + encodeURIComponent(settings.bmClientId);

        var res = sfccClient.doPut(url, token, {});
        var status = res.status;
        if (status === 200 || status === 201 || status === 204) {
            return { ok: true, error: null };
        }
        return { ok: false, error: 'OCAPI returned ' + status };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}

/**
 * Assign an SFCC customer to multiple customer groups.
 * @param {string} customerNo
 * @param {Array<string>} groupIds
 * @param {string} [siteId]
 * @returns {{ ok: boolean, assigned: number, failed: number, errors: Array<string> }}
 */
function assignCustomerToGroups(customerNo, groupIds, siteId) {
    var assigned = 0;
    var failed   = 0;
    var errors   = [];

    for (var i = 0; i < (groupIds || []).length; i++) {
        var result = assignCustomerToGroup(customerNo, groupIds[i], siteId);
        if (result.ok) {
            assigned++;
        } else {
            failed++;
            if (errors.length < 5) errors.push(groupIds[i] + ': ' + result.error);
        }
    }

    return { ok: failed === 0, assigned: assigned, failed: failed, errors: errors };
}

/**
 * Create all selected CT groups in SFCC and return a summary.
 * @param {Array<{ id: string, name: string }>} groups
 * @returns {{ created: number, skipped: number, failed: number, errors: Array<string> }}
 */
function ensureGroups(groups) {
    var created = 0;
    var skipped = 0;
    var failed  = 0;
    var errors  = [];

    for (var i = 0; i < groups.length; i++) {
        var result = ensureGroup(groups[i].id, groups[i].name);
        if (!result.ok) {
            failed++;
            if (errors.length < 5) errors.push(groups[i].id + ': ' + result.error);
        } else if (result.created) {
            created++;
        } else {
            skipped++;
        }
    }

    return { created: created, skipped: skipped, failed: failed, errors: errors };
}

module.exports = {
    ensureGroup:            ensureGroup,
    ensureGroups:           ensureGroups,
    assignCustomerToGroup:  assignCustomerToGroup,
    assignCustomerToGroups: assignCustomerToGroups
};
