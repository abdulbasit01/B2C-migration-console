'use strict';

var cdn = require('./cdn');
var transform = require('./transform');

/**
 * Unwrap common Amplience CDN response envelopes.
 * @param {Object} payload - Raw CDN JSON
 * @returns {Object} Content body
 */
function unwrapCdnPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return {};
    }
    var outer = payload.content;
    if (!outer || typeof outer !== 'object') {
        return payload;
    }

    var schema = String((outer._meta && outer._meta.schema) || '').toLowerCase();
    if (outer.content && (outer.header || schema.indexOf('rich-text') >= 0
        || schema.indexOf('/rich') >= 0 || schema.indexOf('banner') >= 0 || schema.indexOf('hero') >= 0)) {
        return outer;
    }
    if (outer.content && typeof outer.content === 'object' && !outer._meta) {
        return outer.content;
    }
    return outer;
}

/**
 * Fetch live Amplience content from CDN by delivery key, with content-id fallback.
 * Works in browser (fetch) and Node 18+.
 * @param {string} hubName
 * @param {string} deliveryKey
 * @param {Object} [options]
 * @param {string} [options.contentId]
 * @param {Function} [options.fetchImpl] - Custom fetch for tests/SSR
 * @returns {Promise<Object>} Renderer model
 */
function formatContentRef(deliveryKey, contentId) {
    var key = String(deliveryKey || '').trim();
    var id = String(contentId || '').trim();
    if (key) {
        return 'key: ' + key;
    }
    if (id) {
        return 'id: ' + id;
    }
    return '(unknown)';
}

function fetchLiveContent(hubName, deliveryKey, options) {
    options = options || {};
    var fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) {
        return Promise.reject(new Error('fetch is not available; pass options.fetchImpl'));
    }

    var contentRef = formatContentRef(deliveryKey, options.contentId);
    var url = cdn.buildCdnUrl(hubName, deliveryKey);
    if (!url && options.contentId) {
        url = cdn.buildCdnUrlById(hubName, options.contentId);
    }
    if (!url) {
        return Promise.reject(new Error('hubName and deliveryKey or contentId are required'));
    }

    return fetchImpl(url, { method: 'GET' })
        .then(function (res) {
            if (res.ok) {
                return res.json().then(function (payload) {
                    var content = unwrapCdnPayload(payload);
                    var model = transform.toRendererModel(content, {
                        hubName: hubName,
                        deliveryKey: deliveryKey,
                        contentId: options.contentId || '',
                        targetWidget: options.targetWidget || ''
                    });
                    model.liveSource = 'cdn';
                    model.publishedOnCdn = true;
                    return model;
                });
            }
            if (res.status === 404 && options.contentId && deliveryKey) {
                var idUrl = cdn.buildCdnUrlById(hubName, options.contentId);
                return fetchImpl(idUrl, { method: 'GET' }).then(function (idRes) {
                    if (!idRes.ok) {
                        throw new Error('Content not found on CDN (404): ' + contentRef);
                    }
                    return idRes.json().then(function (payload) {
                        var content = unwrapCdnPayload(payload);
                        var model = transform.toRendererModel(content, {
                            hubName: hubName,
                            deliveryKey: deliveryKey,
                            contentId: options.contentId,
                            targetWidget: options.targetWidget || ''
                        });
                        model.liveSource = 'cdn';
                        model.publishedOnCdn = true;
                        return model;
                    });
                });
            }
            throw new Error('Content not found on CDN (' + res.status + '): ' + contentRef);
        });
}

module.exports = {
    unwrapCdnPayload: unwrapCdnPayload,
    fetchLiveContent: fetchLiveContent
};
