'use strict';

var CacheMgr = require('dw/system/CacheMgr');
var cdnUtil = require('*/cartridge/scripts/helpers/amplienceCdn');
var http = require('*/cartridge/scripts/helpers/amplienceHttp');

var CACHE_ID = 'amplienceLiveCdn';

/**
 * Build a stable cache key.
 * @param {string} kind - key|id
 * @param {string} hubName - Amplience hub
 * @param {string} ref - Delivery key or content id
 * @returns {string} Cache key
 */
function cacheKey(kind, hubName, ref) {
    return String(kind || '') + '::' + String(hubName || '') + '::' + String(ref || '');
}

/**
 * Unwrap Amplience CDN payloads to the content body.
 * @param {Object} data - Raw CDN JSON
 * @returns {Object} Content body
 */
function unwrapContent(data) {
    if (!data || typeof data !== 'object') return {};
    if (data.content && typeof data.content === 'object') return data.content;
    return data;
}

/**
 * Read a previously cached CDN payload.
 * @param {string} kind - key|id
 * @param {string} hubName - Amplience hub
 * @param {string} ref - Delivery key or content id
 * @returns {Object|null} Cached fetch result
 */
function getCached(kind, hubName, ref) {
    try {
        var cache = CacheMgr.getCache(CACHE_ID);
        if (!cache) return null;
        return cache.get(cacheKey(kind, hubName, ref)) || null;
    } catch (e) {
        return null;
    }
}

/**
 * Store a CDN payload in the custom cache.
 * @param {string} kind - key|id
 * @param {string} hubName - Amplience hub
 * @param {string} ref - Delivery key or content id
 * @param {Object} value - Fetch result
 * @returns {void}
 */
function putCached(kind, hubName, ref, value) {
    try {
        var cache = CacheMgr.getCache(CACHE_ID);
        if (!cache) return;
        cache.put(cacheKey(kind, hubName, ref), value);
    } catch (e) {
        // Cache is optional.
    }
}

/**
 * Perform one CDN GET with optional short cache.
 * @param {string} kind - key|id
 * @param {string} hubName - Hub name
 * @param {string} ref - Delivery key or content id
 * @param {string} url - Full CDN URL
 * @param {boolean} [bypassCache] - Skip CacheMgr read/write
 * @returns {Object} Fetch result
 */
function fetchUrl(kind, hubName, ref, url, bypassCache) {
    if (!bypassCache) {
        var cached = getCached(kind, hubName, ref);
        if (cached) {
            cached.cached = true;
            return cached;
        }
    }

    var result;
    try {
        var res = http.get(url, { Accept: 'application/json' });
        if (res.status === 200) {
            result = {
                ok: true,
                content: unwrapContent(res.data),
                deliveryKey: kind === 'key' ? ref : '',
                contentId: kind === 'id' ? ref : '',
                cdnUrl: url.split('?')[0],
                error: '',
                cached: false,
                source: kind
            };
            if (!bypassCache) putCached(kind, hubName, ref, result);
            return result;
        }
        result = {
            ok: false,
            content: null,
            deliveryKey: kind === 'key' ? ref : '',
            contentId: kind === 'id' ? ref : '',
            cdnUrl: url.split('?')[0],
            error: 'CDN fetch failed (' + res.status + ') via ' + kind + ': ' + ref,
            cached: false,
            source: kind
        };
    } catch (e) {
        result = {
            ok: false,
            content: null,
            deliveryKey: kind === 'key' ? ref : '',
            contentId: kind === 'id' ? ref : '',
            cdnUrl: url ? String(url).split('?')[0] : '',
            error: String(e.message || e),
            cached: false,
            source: kind
        };
    }

    if (!bypassCache) putCached(kind, hubName, ref, result);
    return result;
}

/**
 * Fetch published Amplience content from CDN by delivery key, then content id.
 * @param {string} hubName - Amplience hub name
 * @param {string} deliveryKey - Published delivery key
 * @param {string} [contentId] - Amplience content UUID fallback
 * @param {Object} [options] - Options
 * @param {boolean} [options.bypassCache] - Force a fresh CDN call
 * @returns {Object} Fetch result
 */
function fetchLive(hubName, deliveryKey, contentId, options) {
    var hub = String(hubName || '').trim();
    var key = String(deliveryKey || '').trim();
    var id = String(contentId || '').trim();
    var opts = options || {};
    var bypassCache = !!opts.bypassCache;

    if (!hub) {
        return {
            ok: false,
            content: null,
            deliveryKey: key,
            contentId: id,
            cdnUrl: '',
            error: 'Set rcMigAmplienceHubName under Site Preferences → B2C Migration Console to enable live CDN refresh.',
            cached: false
        };
    }

    if (key) {
        var byKey = fetchUrl('key', hub, key, cdnUtil.buildCdnUrl(hub, key), bypassCache);
        if (byKey.ok) return byKey;
    }

    if (id) {
        var byId = fetchUrl('id', hub, id, cdnUtil.buildCdnUrlById(hub, id), bypassCache);
        if (byId.ok) return byId;
        if (!key) return byId;
        return {
            ok: false,
            content: null,
            deliveryKey: key,
            contentId: id,
            cdnUrl: byId.cdnUrl || '',
            error: 'CDN 404 for key "' + key + '" and id "' + id
                + '". Publish the item in Amplience Dynamic Content, then retry.',
            cached: false
        };
    }

    return {
        ok: false,
        content: null,
        deliveryKey: key,
        contentId: id,
        cdnUrl: '',
        error: 'No delivery key or Amplience content id available for live refresh.',
        cached: false
    };
}

/**
 * @param {string} hubName
 * @param {string} deliveryKey
 * @returns {Object}
 */
function fetchByDeliveryKey(hubName, deliveryKey) {
    return fetchLive(hubName, deliveryKey, '');
}

module.exports = {
    unwrapContent: unwrapContent,
    fetchLive: fetchLive,
    fetchByDeliveryKey: fetchByDeliveryKey
};
