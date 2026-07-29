'use strict';

/** AUTO-GENERATED from packages/amplience-core — run scripts/sync-amplience-core-to-sfcc.js */

/**
 * Build CDN URL for a delivery key. Keys may contain slashes (e.g. page/jackets);
 * encode each path segment but preserve / separators.
 * @param {string} hubName - Amplience hub name
 * @param {string} deliveryKey - Published delivery key
 * @returns {string} CDN URL
 */
function buildCdnUrl(hubName, deliveryKey) {
    var hub = String(hubName || '').trim();
    var key = String(deliveryKey || '').trim();
    if (!hub || !key) {
        return '';
    }
    var segments = key.split('/');
    var encoded = [];
    var i;
    for (i = 0; i < segments.length; i++) {
        encoded.push(encodeURIComponent(segments[i]));
    }
    return 'https://' + hub + '.cdn.content.amplience.net/content/key/'
        + encoded.join('/') + '?depth=all&format=inlined';
}

/**
 * Build CDN URL for an Amplience content item id (published content).
 * @param {string} hubName - Amplience hub name
 * @param {string} contentId - Amplience content UUID
 * @returns {string} CDN URL
 */
function buildCdnUrlById(hubName, contentId) {
    var hub = String(hubName || '').trim();
    var id = String(contentId || '').trim();
    if (!hub || !id) {
        return '';
    }
    return 'https://' + hub + '.cdn.content.amplience.net/content/id/'
        + encodeURIComponent(id) + '?depth=all&format=inlined';
}

module.exports = {
    buildCdnUrl: buildCdnUrl,
    buildCdnUrlById: buildCdnUrlById
};
