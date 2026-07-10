'use strict';

var fetcher     = require('*/cartridge/scripts/migration/customerMigration/shopifyCustomerFetcher');
var transformer = require('*/cartridge/scripts/migration/customerMigration/shopifyCustomerTransformer');

var FETCH_PAGE_SIZE = 250;
var MAX_PAGES        = 200; // safety cap: 200 * 250 = 50,000 customers

/**
 * Derive a stable, SFCC-safe customer group ID from a free-text Shopify tag.
 * Must stay in sync with shopifyCustomerXmlBuilder, which assigns customers to
 * groups using this same function.
 * @param {string} tag
 * @returns {string}
 */
function groupIdForTag(tag) {
    var slug = String(tag || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    if (!slug) slug = 'tag';
    return ('shopify_tag_' + slug).substring(0, 100);
}

/**
 * Shopify has no direct equivalent of a CTP customer group — the closest analog is
 * customer tags. This derives one SFCC customer group per distinct tag found across
 * all Shopify customers by paging through the full customer list.
 * @returns {Array<{ id: string, key: string, name: string }>}
 */
function fetchGroups() {
    var seen      = {};
    var groups    = [];
    var pageInfo  = null;
    var customers = [];
    var pages     = 0;

    do {
        var page = fetcher.fetchPage(pageInfo, FETCH_PAGE_SIZE);
        customers = page.results || [];
        pageInfo  = page.nextPageInfo;
        pages++;

        for (var i = 0; i < customers.length; i++) {
            var tags = transformer.parseTags(customers[i].tags);
            for (var t = 0; t < tags.length; t++) {
                var id = groupIdForTag(tags[t]);
                if (!seen[id]) {
                    seen[id] = true;
                    groups.push({ id: id, key: id, name: tags[t] });
                }
            }
        }
    } while (pageInfo && customers.length > 0 && pages < MAX_PAGES);

    return groups;
}

module.exports = { fetchGroups: fetchGroups, groupIdForTag: groupIdForTag };
