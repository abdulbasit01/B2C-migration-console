'use strict';

/**
 * Shared native-field equivalence rules for all migration connectors.
 *
 * Rules are keyed by: platform → SFCC task name → source attribute ID.
 * Each rule has:
 *   sfccField {string} — the SFCC built-in field this source attribute duplicates
 *   action    {string} — "flag"  : show info hint in AI Map; still create if user proceeds
 *                        "skip"  : exclude from migration batch entirely
 *   note      {string} — human-readable explanation shown in the UI
 *
 * To extend: add entries to nativeFieldMap.json — no connector or runner code changes needed.
 */

var rules = require('*/cartridge/scripts/migration/config/nativeFieldMap.json');

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
    if (!rule) return null;
    return {
        sfccField: rule.sfccField,
        action:    rule.action,
        note:      'Equivalent to native SFCC ' + rule.sfccField + ' — may not need separate migration.'
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

module.exports = { getRule: getRule, isSkipped: isSkipped };
