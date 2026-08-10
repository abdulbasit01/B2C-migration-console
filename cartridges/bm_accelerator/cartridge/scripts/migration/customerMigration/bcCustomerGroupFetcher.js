'use strict';

var bigcommerceApi = require('*/cartridge/scripts/migration/core/bigcommerceApi');

/**
 * Derive a stable, SFCC-safe customer group ID from a BigCommerce customer group.
 * Must stay in sync with bcCustomerXmlBuilder, which assigns customers to groups
 * using this same function.
 * @param {string|number} groupId
 * @param {string} [name]
 * @returns {string}
 */
function groupIdForBcGroup(groupId, name) {
    var idPart = String(groupId != null ? groupId : '').trim();
    if (idPart) {
        return ('bc_cg_' + idPart).substring(0, 100);
    }
    var slug = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    if (!slug) slug = 'group';
    return ('bc_cg_' + slug).substring(0, 100);
}

/**
 * Fetch BigCommerce customer groups via V2 GET /v2/customer_groups.
 * @returns {Array<{ id: string, key: string, name: string }>}
 */
function fetchGroups() {
    var raw = bigcommerceApi.fetchAll('/customer_groups', null, {
        version: 'v2',
        limit:   250
    });
    var groups = [];
    var i;
    for (i = 0; i < raw.length; i++) {
        var g  = raw[i];
        var id = groupIdForBcGroup(g.id, g.name);
        groups.push({
            id:   id,
            key:  id,
            name: g.name || id
        });
    }
    return groups;
}

module.exports = {
    fetchGroups:       fetchGroups,
    groupIdForBcGroup: groupIdForBcGroup
};
