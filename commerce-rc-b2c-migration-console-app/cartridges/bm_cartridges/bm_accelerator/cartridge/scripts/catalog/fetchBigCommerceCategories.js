'use strict';

var bigcommerceApi = require('*/cartridge/scripts/migration/core/bigcommerceApi');
var Logger         = require('dw/system/Logger');

var PAGE_SIZE = 50;

/**
 * Map a BigCommerce category node to the shared {id, name, parentId} shape.
 * Supports trees/categories (category_id) and legacy catalog/categories (id).
 * @param {Object} cat
 * @returns {Object|null}
 */
function mapCategory(cat) {
    if (!cat) return null;
    var id = cat.category_id != null ? cat.category_id : cat.id;
    if (id == null) return null;
    var parentRaw = cat.parent_id;
    var parentId  = (parentRaw && parentRaw !== 0 && parentRaw !== '0')
        ? String(parentRaw)
        : '';
    return {
        id:       String(id),
        name:     String(cat.name || ('Category ' + id)),
        parentId: parentId
    };
}

/**
 * Fetch one page of categories. Tries trees API first, falls back to legacy categories.
 * @param {number} page - 1-based page
 * @param {number} limit
 * @returns {{ results: Array, totalPages: number|null, total: number|null, usedPath: string }}
 */
function fetchCategoryPage(page, limit) {
    var lim = limit || PAGE_SIZE;
    var paths = ['/catalog/trees/categories', '/catalog/categories'];
    var pi;

    for (pi = 0; pi < paths.length; pi++) {
        try {
            var res   = bigcommerceApi.get(
                paths[pi] + '?limit=' + lim + '&page=' + page,
                null,
                'v3'
            );
            var batch = bigcommerceApi.extractList(res.data);
            var meta  = bigcommerceApi.extractMeta(res.data);
            var results = [];
            var i;
            for (i = 0; i < batch.length; i++) {
                var mapped = mapCategory(batch[i]);
                if (mapped) results.push(mapped);
            }
            return {
                results:    results,
                totalPages: meta.totalPages,
                total:      meta.total,
                usedPath:   paths[pi]
            };
        } catch (e) {
            Logger.warn('fetchBigCommerceCategories: {0} failed: {1}', paths[pi], e.message);
        }
    }

    return { results: [], totalPages: 0, total: 0, usedPath: '' };
}

/**
 * Paginate BigCommerce V3 categories.
 * @param {string} offsetStr - page number as string (0 or 1 starts at page 1)
 * @returns {{ results: Array, nextCursor: string, done: boolean }}
 */
function fetchCollectionsPage(offsetStr) {
    var raw  = String(offsetStr || '0');
    var page = parseInt(raw, 10);
    if (isNaN(page) || page < 0) page = 0;
    // Accept "0" from UI first call; convert to 1-based API page.
    var apiPage = page < 1 ? 1 : page;

    var fetched = fetchCategoryPage(apiPage, PAGE_SIZE);
    var results = fetched.results || [];
    var done    = false;

    if (fetched.totalPages != null) {
        done = apiPage >= fetched.totalPages || results.length === 0;
    } else {
        done = results.length < PAGE_SIZE;
    }

    var nextCursor = done ? '' : String(apiPage + 1);

    Logger.info(
        'fetchBigCommerceCategories: page={0} count={1} done={2} path={3}',
        apiPage,
        results.length,
        done,
        fetched.usedPath
    );

    return {
        results:    results,
        nextCursor: nextCursor,
        done:       done
    };
}

module.exports = {
    fetchCollectionsPage: fetchCollectionsPage,
    mapCategory:          mapCategory
};
