'use strict';

/* global session */

/**
 * Visit-scoped source→SFCC attribute ID remaps, keyed by migration module.
 * Cleared on module page load / leave so renames do not leak across visits.
 */

var PREFIX = 'attrIdMap_';

/**
 * @param {string} moduleKey - e.g. store, inventory, customer
 * @returns {string}
 */
function sessionKey(moduleKey) {
    return PREFIX + String(moduleKey || 'default');
}

/**
 * @param {string} moduleKey
 * @returns {Object.<string, string>}
 */
function read(moduleKey) {
    try {
        if (typeof session === 'undefined' || !session || !session.custom) return {};
        var raw = String(session.custom[sessionKey(moduleKey)] || '{}');
        if (!raw || raw === '{}' || raw === 'null') return {};
        var parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
        return {};
    }
}

/**
 * @param {string} moduleKey
 * @param {Object.<string, string>} map
 */
function write(moduleKey, map) {
    try {
        if (typeof session === 'undefined' || !session || !session.custom) return;
        session.custom[sessionKey(moduleKey)] = JSON.stringify(map || {});
    } catch (e) { /* ignore */ }
}

/**
 * @param {string} moduleKey
 */
function clear(moduleKey) {
    try {
        if (typeof session === 'undefined' || !session || !session.custom) return;
        // Prefer null (removes custom attr) then '{}' so read() always returns {}.
        session.custom[sessionKey(moduleKey)] = null;
        session.custom[sessionKey(moduleKey)] = '{}';
    } catch (e) { /* ignore */ }
}

/**
 * Persist remaps from create-attrs results: [{ id, canonicalId }].
 * @param {string} moduleKey
 * @param {Array} attrs
 */
function saveFromAttrs(moduleKey, attrs) {
    var map = read(moduleKey);
    var i;
    for (i = 0; i < (attrs || []).length; i++) {
        var attr = attrs[i];
        if (!attr) continue;
        var canonical = attr.canonicalId || attr.sourceId || '';
        var target    = attr.id || '';
        if (!canonical || !target) continue;
        if (canonical !== target) {
            map[canonical] = target;
        } else if (map[canonical]) {
            delete map[canonical];
        }
    }
    write(moduleKey, map);
}

/**
 * Resolve SFCC attribute-id for a source field (applies user renames).
 * @param {string} sourceId
 * @param {string|Object.<string, string>} moduleKeyOrMap
 * @returns {string}
 */
function resolve(sourceId, moduleKeyOrMap) {
    if (!sourceId) return '';
    var map = typeof moduleKeyOrMap === 'string'
        ? read(moduleKeyOrMap)
        : (moduleKeyOrMap || {});
    var mapped = map[sourceId];
    return mapped && String(mapped).trim() ? String(mapped).trim() : sourceId;
}

module.exports = {
    PREFIX:        PREFIX,
    sessionKey:    sessionKey,
    read:          read,
    write:         write,
    clear:         clear,
    saveFromAttrs: saveFromAttrs,
    resolve:       resolve
};
