'use strict';

/**
 * Build CDN URL for a delivery key. Keys may contain slashes (e.g. page/jackets);
 * encode each path segment but preserve / separators.
 * @param {string} hubName
 * @param {string} deliveryKey
 * @returns {string}
 */
function buildCdnUrl(hubName, deliveryKey) {
    var hub = String(hubName || '').trim();
    var key = String(deliveryKey || '').trim();
    if (!hub || !key) {
        return '';
    }
    var segments = key.split('/');
    var encoded  = [];
    for (var i = 0; i < segments.length; i++) {
        encoded.push(encodeURIComponent(segments[i]));
    }
    return 'https://' + hub + '.cdn.content.amplience.net/content/key/'
        + encoded.join('/') + '?depth=all&format=inlined';
}

module.exports = {
    buildCdnUrl: buildCdnUrl
};
