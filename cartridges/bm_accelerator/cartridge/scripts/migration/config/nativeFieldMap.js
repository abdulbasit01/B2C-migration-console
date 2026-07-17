'use strict';

/**
 * Shared native-field equivalence rules for all migration connectors.
 *
 * Rules are keyed by: platform → SFCC task name → source attribute ID.
 * Each rule has:
 *   sfccField {string} — the SFCC built-in field this source attribute duplicates
 *   action    {string} — "flag"  : show info hint in AI Map; still create if user proceeds
 *                        "skip"  : exclude from migration batch entirely
 *   note      {string} [optional] — custom explanation shown in the UI; falls back to a
 *             generated default ("Equivalent to native SFCC <sfccField> ...") when omitted
 *
 * To extend: add entries to nativeFieldMap.json — no connector or runner code changes needed.
 */

var rules    = require('*/cartridge/scripts/migration/config/nativeFieldMap.json');
var detector = require('*/cartridge/scripts/migration/core/nativeFieldDetector');

/**
 * Return the rule for a given attribute, or null if none applies.
 * @param {string} platformId - connector id (e.g. "commercetools", "shopify")
 * @param {string} task       - runner task name (e.g. "Product")
 * @param {string} attrId     - source attribute / field key
 * @returns {{ sfccField: string, action: string, note: string }|null}
 */
function getRule(platformId, task, attrId) {
    var platform = rules[platformId];
    if (!platform) return null;
    var taskRules = platform[task];
    if (!taskRules) return null;
    var rule = taskRules[attrId];
    if (!rule) {
        // Case-insensitive fallback (e.g. Shopify option names vary in casing per store)
        var lower = String(attrId || '').toLowerCase();
        var keys  = Object.keys(taskRules);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].toLowerCase() === lower) { rule = taskRules[keys[i]]; break; }
        }
    }
    if (!rule) return null;
    return {
        sfccField: rule.sfccField,
        action:    rule.action,
        note:      rule.note || ('Equivalent to native SFCC ' + rule.sfccField + ' — may not need separate migration.')
    };
}

/**
 * Return true when an attribute should be excluded from the migration batch.
 * @param {string} platformId
 * @param {string} task
 * @param {string} attrId
 * @returns {boolean}
 */
function isSkipped(platformId, task, attrId) {
    var rule = getRule(platformId, task, attrId);
    return !!(rule && rule.action === 'skip');
}

/**
 * Curated rules win when present (they can carry a precise, hand-written note).
 * Otherwise, fall back to live detection against SFCC's own system attributes —
 * this is what catches fields nobody has explicitly mapped yet (any connector's
 * custom fields/metafields included), not just a fixed list.
 * @param {string} platformId
 * @param {string} task
 * @param {string} attrId    - source field id/key
 * @param {string} [attrLabel] - source field human label, improves match quality
 * @param {Array<{id: string, displayName: string, system: boolean}>} [sfccAttrs]
 *        - live SFCC attribute list for the target object type; omit to skip detection
 * @returns {{ sfccField: string, action: string, note: string }|null}
 */
function getEffectiveRule(platformId, task, attrId, attrLabel, sfccAttrs) {
    var staticRule = getRule(platformId, task, attrId);
    if (staticRule) return staticRule;
    if (!sfccAttrs || !sfccAttrs.length) return null;

    var matches = detector.findNativeMatches(attrId, attrLabel, sfccAttrs);
    if (!matches.length) return null;

    var best = matches[0];
    return {
        sfccField: best.id,
        action:    'flag',
        note:      'Looks similar to existing SFCC field "' + (best.displayName || best.id) + '" (' + best.id + ') — consider mapping to it instead of a new custom attribute.'
    };
}

module.exports = { getRule: getRule, isSkipped: isSkipped, getEffectiveRule: getEffectiveRule };
