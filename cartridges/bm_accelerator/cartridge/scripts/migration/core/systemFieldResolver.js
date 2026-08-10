'use strict';

/**
 * Resolve SFCC system field values from schema mapping + visit-scoped session maps.
 * Shared by product (now) and other object writers (customers/orders/etc. later).
 *
 * Order:
 *   1. Session AI/user maps (attrIdMapSession) — user overrides
 *   2. Curated nativeFieldMap aliases (getSourcesForSystemField)
 * First non-empty getSourceValue(sourceKey) wins.
 */

var nativeFieldMap   = require('*/cartridge/scripts/migration/config/nativeFieldMap');
var attrIdMapSession = require('*/cartridge/scripts/migration/core/attrIdMapSession');

/**
 * @param {Array<string>} a
 * @param {Array<string>} b
 * @returns {Array<string>}
 */
function mergeUnique(a, b) {
    var seen = {};
    var out = [];
    var lists = [a || [], b || []];
    var li;
    var i;
    for (li = 0; li < lists.length; li++) {
        for (i = 0; i < lists[li].length; i++) {
            var key = lists[li][i];
            if (!key || seen[key]) continue;
            seen[key] = true;
            out.push(key);
        }
    }
    return out;
}

/**
 * Source keys that map to an SFCC system field (session first, then curated).
 * @param {string} platformId
 * @param {string} task
 * @param {string} sfccField
 * @param {string} [moduleKey] - attrIdMapSession module (e.g. product)
 * @returns {Array<string>}
 */
function getSourceKeys(platformId, task, sfccField, moduleKey) {
    var sessionSources = moduleKey
        ? attrIdMapSession.sourcesForTarget(moduleKey, sfccField)
        : [];
    var curatedSources = nativeFieldMap.getSourcesForSystemField(platformId, task, sfccField);
    return mergeUnique(sessionSources, curatedSources);
}

/**
 * Resolve a single SFCC system field value via schema + session maps.
 * @param {Object} opts
 * @param {string} opts.platformId
 * @param {string} opts.task
 * @param {string} opts.sfccField
 * @param {string} [opts.moduleKey]
 * @param {function(string): string} opts.getSourceValue - source key → value
 * @returns {string}
 */
function resolve(opts) {
    opts = opts || {};
    var getSourceValue = opts.getSourceValue;
    if (typeof getSourceValue !== 'function' || !opts.sfccField) return '';

    var keys = getSourceKeys(opts.platformId, opts.task, opts.sfccField, opts.moduleKey);
    var i;
    for (i = 0; i < keys.length; i++) {
        var val = getSourceValue(keys[i]);
        if (val !== null && val !== undefined && String(val).trim() !== '') {
            return String(val);
        }
    }
    return '';
}

module.exports = {
    getSourceKeys: getSourceKeys,
    resolve:       resolve
};
