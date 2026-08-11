'use strict';

/**
 * Fetch categories from SAP Commerce Cloud OCC v2.
 * Retrieves the catalog tree via /catalogs?fields=FULL and flattens it
 * into a paged list of { id, name, description, parentId, sapCode }.
 */

var sapApi  = require('*/cartridge/scripts/migration/core/sapApi');
var Logger  = require('dw/system/Logger');

var PAGE_SIZE = 200;

function sanitizeId(str) {
    return String(str || '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Recursively flatten a SAP category node and its subcategories.
 * @param {Object} cat      - SAP category node
 * @param {string} parentId - SFCC parent ID ('root' for top-level nodes)
 * @param {Array}  out      - accumulator
 * @param {Object} seen     - map of already-used SFCC IDs to detect duplicates
 */
function flattenCategory(cat, parentId, out, seen) {
    if (!cat || !cat.id) return;
    var baseId = sanitizeId(String(cat.name || '')) || sanitizeId(String(cat.id));
    if (!baseId) return;
    // Append SAP code when name collides with an already-assigned ID (prevents parent loops)
    var sfccId = seen[baseId] ? baseId + '-' + sanitizeId(String(cat.id)) : baseId;
    seen[sfccId] = true;
    out.push({
        id         : sfccId,
        name       : String(cat.name || cat.id),
        description: String(cat.description || ''),
        parentId   : parentId || 'root',
        sapCode    : String(cat.id)
    });
    var subs = cat.subcategories || [];
    for (var i = 0; i < subs.length; i++) {
        flattenCategory(subs[i], sfccId, out, seen);
    }
}

/**
 * Fetch all categories from SAP OCC. Uses the first catalog's Online version;
 * falls back to the first available version if Online is not present.
 * @returns {Array} flat list of { id, name, description, parentId, sapCode }
 */
function fetchAllCategories() {
    var res      = sapApi.get('/catalogs?fields=FULL');
    var catalogs = (res.data && res.data.catalogs) || [];
    var flat     = [];

    var targetVersion = null;
    for (var ci = 0; ci < catalogs.length; ci++) {
        var versions = catalogs[ci].catalogVersions || [];
        for (var vi = 0; vi < versions.length; vi++) {
            if (versions[vi].id === 'Online') { targetVersion = versions[vi]; break; }
        }
        if (!targetVersion && versions.length) targetVersion = versions[0];
        if (targetVersion) break;
    }

    if (!targetVersion) {
        Logger.warn('fetchSAPCategories: no catalog version found in SAP response');
        return flat;
    }

    var seen  = {};
    var roots = targetVersion.categories || [];
    for (var ri = 0; ri < roots.length; ri++) {
        flattenCategory(roots[ri], 'root', flat, seen);
    }

    Logger.info('fetchSAPCategories: {0} categories flattened', flat.length);
    return flat;
}

/**
 * Return one page of SAP categories (offset-based).
 * @param {number|string} offset
 * @param {number}        [limit]
 * @returns {{ results: Array, total: number, done: boolean }}
 */
function fetchCategoriesPage(offset, limit) {
    offset     = parseInt(offset, 10) || 0;
    limit      = limit || PAGE_SIZE;
    var all    = fetchAllCategories();
    var page   = all.slice(offset, offset + limit);
    return {
        results: page,
        total  : all.length,
        done   : (offset + page.length) >= all.length
    };
}

module.exports = {
    fetchAllCategories  : fetchAllCategories,
    fetchCategoriesPage : fetchCategoriesPage
};
