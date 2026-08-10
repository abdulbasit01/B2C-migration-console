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
 * When id === canonicalId (or remove:true), clears that remap.
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
        if (!canonical) continue;
        if (attr.remove || !target || canonical === target) {
            if (map[canonical]) delete map[canonical];
            continue;
        }
        map[canonical] = target;
    }
    write(moduleKey, map);
}

/**
 * Remove one source→SFCC remap.
 * @param {string} moduleKey
 * @param {string} sourceId
 */
function removeMapping(moduleKey, sourceId) {
    if (!sourceId) return;
    var map = read(moduleKey);
    if (map[sourceId]) {
        delete map[sourceId];
        write(moduleKey, map);
    }
}

/**
 * Source field ids that map to a given SFCC target (reverse of resolve).
 * @param {string|Object.<string, string>} moduleKeyOrMap
 * @param {string} sfccField
 * @returns {Array<string>}
 */
function sourcesForTarget(moduleKeyOrMap, sfccField) {
    if (!sfccField) return [];
    var map = typeof moduleKeyOrMap === 'string'
        ? read(moduleKeyOrMap)
        : (moduleKeyOrMap || {});
    var target = String(sfccField).trim();
    var targetLower = target.toLowerCase();
    var out = [];
    var keys = Object.keys(map);
    var i;
    for (i = 0; i < keys.length; i++) {
        var src = keys[i];
        var mapped = map[src] != null ? String(map[src]).trim() : '';
        if (!mapped) continue;
        if (mapped === target || mapped.toLowerCase() === targetLower) {
            out.push(src);
        }
    }
    return out;
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
    PREFIX:           PREFIX,
    sessionKey:       sessionKey,
    read:             read,
    write:            write,
    clear:            clear,
    saveFromAttrs:    saveFromAttrs,
    removeMapping:    removeMapping,
    sourcesForTarget: sourcesForTarget,
    resolve:          resolve
};
