'use strict';

/**
 * Create an SFCC customer group if it does not already exist.
 * Uses the exact CTP group ID so the bridge between systems is preserved.
 *
 * There is no Script API manager for customer groups (dw.customer.CustomerGroupMgr
 * does not exist) — groups must be created via the OCAPI Data API:
 * PUT /s/-/dw/data/{version}/sites/{site_id}/customer_groups/{id}
 * A repeat PUT on an existing group returns 409, so existence is checked with a GET first.
 *
 * @param {string} groupId   - CTP customer group UUID (used as SFCC group ID)
 * @param {string} groupName - Human-readable name from CTP
 * @returns {{ ok: boolean, created: boolean, error: string|null }}
 */
function ensureGroup(groupId, groupName) {
    try {
        var sfccClient = require('*/cartridge/scripts/migration/sfccClient');
        var Site       = require('dw/system/Site');
        var HTTPClient = require('dw/net/HTTPClient');

        var token    = sfccClient.getSFCCToken();
        var settings = sfccClient.getSFCCSettings();
        var siteId   = Site.getCurrent().getID();
        var url      = settings.baseUrl
            + '/s/-/dw/data/' + settings.metaVersion
            + '/sites/' + encodeURIComponent(siteId)
            + '/customer_groups/' + encodeURIComponent(groupId)
            + '?client_id=' + encodeURIComponent(settings.bmClientId);

        var getClient = new HTTPClient();
        getClient.setTimeout(30000);
        getClient.open('GET', url);
        getClient.setRequestHeader('Authorization', 'Bearer ' + token);
        getClient.send();
        if (getClient.getStatusCode() === 200) {
            return { ok: true, created: false, error: null };
        }

        var putClient = new HTTPClient();
        putClient.setTimeout(30000);
        putClient.open('PUT', url);
        putClient.setRequestHeader('Authorization', 'Bearer ' + token);
        putClient.setRequestHeader('Content-Type', 'application/json');
        putClient.send(JSON.stringify({ description: groupName || groupId, type: 'static' }));

        var status = putClient.getStatusCode();
        if (status === 200 || status === 201) {
            return { ok: true, created: true, error: null };
        }
        if (status === 409) {
            return { ok: true, created: false, error: null };
        }
        return { ok: false, created: false, error: 'OCAPI returned ' + status + ': ' + putClient.getText() };
    } catch (e) {
        return { ok: false, created: false, error: e.message || String(e) };
    }
}

/**
 * Assign an SFCC customer to a customer group via the OCAPI Data API.
 * PUT /s/-/dw/data/{version}/sites/{site_id}/customer_groups/{groupId}/members/{customerNo}
 *
 * @param {string} customerNo - SFCC customer number
 * @param {string} groupId    - SFCC customer group ID (same as CTP group ID)
 * @param {string} [siteId]   - SFCC site ID (e.g. "RefArch"); defaults to the current site
 * @returns {{ ok: boolean, error: string|null }}
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

        var HTTPClient = require('dw/net/HTTPClient');
        var client = new HTTPClient();
        client.setTimeout(30000);
        client.open('PUT', url);
        client.setRequestHeader('Authorization', 'Bearer ' + token);
        client.setRequestHeader('Content-Type', 'application/json');
        client.send('{}');

        var status = client.getStatusCode();
        if (status === 200 || status === 201 || status === 204) {
            return { ok: true, error: null };
        }
        return { ok: false, error: 'OCAPI returned ' + status + ': ' + client.getText() };
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
 * Create all selected CTP groups in SFCC and return a summary.
 *
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
