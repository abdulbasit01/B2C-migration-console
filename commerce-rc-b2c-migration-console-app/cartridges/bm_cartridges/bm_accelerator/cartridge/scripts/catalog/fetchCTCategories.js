'use strict';

var log = require('*/cartridge/scripts/migration/core/migrationLogger').catalog;
var cfg = require('*/cartridge/scripts/migration/configAccessor');
var serviceHttp = require('*/cartridge/scripts/migration/core/serviceHttp');
var Bytes = require('dw/util/Bytes');
var Encoding = require('dw/crypto/Encoding');

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

/**
 * Obtain a commercetools OAuth token via Service Framework.
 * @returns {string|null}
 */
function getCTAuthToken() {
    var c = cfg.ctp;

    if (!c || !c.authUrl || !c.clientId || !c.clientSecret || !c.projectKey) {
        log.error('getCTAuthToken: missing CT configuration (projectKey/clientId/authUrl)');
        return null;
    }

    var tokenUrl = c.authUrl + '/oauth/token';
    var scope = 'manage_project:' + c.projectKey;
    var body = 'grant_type=client_credentials&scope=' + encodeURIComponent(scope);
    var basicAuth = 'Basic ' + toBase64(c.clientId + ':' + c.clientSecret);

    log.info('getCTAuthToken: requesting token for project {0}', c.projectKey);

    try {
        var res = serviceHttp.post('ctp', tokenUrl, {
            Authorization:  basicAuth,
            'Content-Type': 'application/x-www-form-urlencoded'
        }, body);

        if (res.status !== 200 || !res.data || !res.data.access_token) {
            log.error('getCTAuthToken failed: status={0}', res.status);
            return null;
        }

        log.info('getCTAuthToken: success');
        return res.data.access_token;
    } catch (e) {
        log.error('getCTAuthToken exception: {0}', e.message);
        return null;
    }
}

/**
 * Fetch all categories from CT with pagination.
 * @param {string} token
 * @returns {Array}
 */
function fetchAllCategories(token) {
    var c = cfg.ctp;
    var allCategories = [];
    var limit = 500;
    var offset = 0;
    var total = null;

    do {
        var url = c.apiUrl + '/' + c.projectKey
            + '/categories?limit=' + limit
            + '&offset=' + offset
            + '&withTotal=true';

        try {
            var res = serviceHttp.get('ctp', url, {
                Authorization:  'Bearer ' + token,
                'Content-Type': 'application/json'
            });

            if (res.status !== 200) {
                log.error('fetchAllCategories failed at offset {0}: status={1}', offset, res.status);
                break;
            }

            if (total === null) {
                total = res.data.total || 0;
                log.info('fetchAllCategories: total={0}', total);
            }

            var results = res.data.results || [];
            var ri;
            for (ri = 0; ri < results.length; ri++) {
                allCategories.push(results[ri]);
            }

            offset += limit;
        } catch (e) {
            log.error('fetchAllCategories exception at offset {0}: {1}', offset, e.message);
            break;
        }
    } while (total !== null && offset < total);

    log.info('fetchAllCategories: complete, total fetched={0}', allCategories.length);
    return allCategories;
}

/**
 * Fetch a single page of CT categories.
 */
function fetchCategoriesPage(token, limit, offset) {
    var c = cfg.ctp;
    limit = limit || 500;
    offset = offset || 0;

    var url = c.apiUrl + '/' + c.projectKey
        + '/categories?limit=' + limit
        + '&offset=' + offset
        + '&sort=orderHint%20asc'
        + '&withTotal=true';

    var res = serviceHttp.get('ctp', url, {
        Authorization:  'Bearer ' + token,
        'Content-Type': 'application/json'
    });

    if (res.status !== 200) {
        throw new Error('CT fetch failed: ' + res.status);
    }

    var results = res.data.results || [];
    var idToKey = {};
    results.forEach(function (cat) {
        if (cat.key) { idToKey[cat.id] = cat.key; }
    });

    return { results: results, total: res.data.total || 0, idToKey: idToKey };
}

/**
 * Fetch categories by parent, sorted by orderHint.
 * @param {string} token - CT auth token
 * @param {string} parentId - parent category ID, or null for root-level categories
 * @returns {Array} sorted categories
 */
function fetchCategoriesByParent(token, parentId) {
    var c = cfg.ctp;
    var allResults = [];
    var limit = 500;
    var offset = 0;
    var total = null;

    var whereClause = parentId
        ? 'parent(id%20%3D%20%22' + encodeURIComponent(parentId) + '%22)'
        : 'parent%20is%20not%20defined';

    do {
        var url = c.apiUrl + '/' + c.projectKey
            + '/categories?limit=' + limit
            + '&offset=' + offset
            + '&where=' + whereClause
            + '&sort=orderHint%20asc'
            + '&withTotal=true';

        try {
            var res = serviceHttp.get('ctp', url, {
                Authorization:  'Bearer ' + token,
                'Content-Type': 'application/json'
            });

            if (res.status !== 200) {
                log.error('fetchCategoriesByParent failed at offset {0}: status={1}', offset, res.status);
                break;
            }

            if (total === null) {
                total = res.data.total || 0;
            }

            var results = res.data.results || [];
            for (var i = 0; i < results.length; i++) {
                allResults.push(results[i]);
            }

            offset += limit;
        } catch (e) {
            log.error('fetchCategoriesByParent exception: {0}', String(e));
            break;
        }
    } while (total !== null && offset < total);

    return allResults;
}

module.exports = {
    getCTAuthToken: getCTAuthToken,
    fetchAllCategories: fetchAllCategories,
    fetchCategoriesPage: fetchCategoriesPage,
    fetchCategoriesByParent: fetchCategoriesByParent
};
