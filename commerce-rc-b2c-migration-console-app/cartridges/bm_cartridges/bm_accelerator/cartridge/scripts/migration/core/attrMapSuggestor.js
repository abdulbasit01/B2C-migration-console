'use strict';

/**
 * OpenAI-assisted SFCC system mapping suggestions for Check Attributes
 * create candidates only. Never auto-maps; never writes nativeFieldMap aliases.
 *
 * Allow-list = SFCC system attrs minus curated alias targets in nativeFieldMap.json
 * (and any extra excludeSfccFields from the live Check Attributes mapped section).
 */

var Logger = require('dw/system/Logger').getLogger('bm_accelerator', 'AttrMapSuggestor');
var openAiClient = require('*/cartridge/scripts/migration/core/openAiClient');
var nativeFieldMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');
var registry = require('*/cartridge/scripts/migration/core/dataSourceRegistry');

var BATCH_SIZE = 40;
var MAX_TARGETS = 5;

/**
 * @param {Array<string>} ids
 * @returns {Object.<string, true>}
 */
function toExcludeSet(ids) {
    var set = {};
    var i;
    for (i = 0; i < (ids || []).length; i++) {
        var id = String(ids[i] || '').trim();
        if (id) set[id.toLowerCase()] = true;
    }
    return set;
}

/**
 * Build allow-list of SFCC system attribute ids still free for AI suggestions.
 * Prefer live OCAPI system attrs; fall back to curated sfccSystem dump.
 * Excludes nativeFieldMap alias targets (+ optional extra excludes).
 * @param {string} taskName
 * @param {Array<{id: string}>} [liveSystemAttrs]
 * @param {string} [platformId]
 * @param {Array<string>} [extraExclude]
 * @returns {Array<string>}
 */
function buildAllowedSystemIds(taskName, liveSystemAttrs, platformId, extraExclude) {
    var platform = platformId || '';
    try {
        if (!platform) platform = registry.getPlatformId();
    } catch (e) {
        platform = platform || 'ct';
    }

    var exclude = toExcludeSet(
        (nativeFieldMap.getClaimedSystemFields(platform, taskName) || [])
            .concat(extraExclude || [])
    );

    var candidates = [];
    var i;
    var id;
    if (liveSystemAttrs && liveSystemAttrs.length) {
        for (i = 0; i < liveSystemAttrs.length; i++) {
            id = liveSystemAttrs[i] && liveSystemAttrs[i].id;
            if (id) candidates.push(String(id));
        }
    } else {
        var dump = nativeFieldMap.getSystemIds(taskName) || [];
        for (i = 0; i < dump.length; i++) {
            if (dump[i]) candidates.push(String(dump[i]));
        }
    }

    var seen = {};
    var out = [];
    for (i = 0; i < candidates.length; i++) {
        id = candidates[i];
        if (!id || seen[id] || exclude[id.toLowerCase()]) continue;
        seen[id] = true;
        out.push(id);
    }
    return out;
}

/**
 * Keep only targets whose sfccField is in the allow-list (case-insensitive → canonical).
 * @param {Array} targets
 * @param {Object.<string, string>} allowedLowerToCanon - lower → canonical id
 * @returns {Array<{sfccField: string, confidence: number, reason: string}>}
 */
function filterTargets(targets, allowedLowerToCanon) {
    var out = [];
    var seen = {};
    var i;
    for (i = 0; i < (targets || []).length; i++) {
        var t = targets[i];
        if (!t) continue;
        var raw = String(t.sfccField || t.id || '').trim();
        if (!raw) continue;
        var canon = allowedLowerToCanon[raw.toLowerCase()];
        if (!canon || seen[canon]) continue;
        seen[canon] = true;
        var conf = parseFloat(t.confidence);
        if (isNaN(conf)) conf = 0;
        if (conf > 1 && conf <= 100) conf = conf / 100;
        if (conf < 0) conf = 0;
        if (conf > 1) conf = 1;
        out.push({
            sfccField:  canon,
            confidence: conf,
            reason:     String(t.reason || '').substring(0, 240)
        });
        if (out.length >= MAX_TARGETS) break;
    }
    return out;
}

/**
 * @param {Array<string>} allowedIds
 * @returns {Object.<string, string>}
 */
function toLowerIndex(allowedIds) {
    var idx = {};
    var i;
    for (i = 0; i < (allowedIds || []).length; i++) {
        var id = String(allowedIds[i] || '');
        if (id) idx[id.toLowerCase()] = id;
    }
    return idx;
}

/**
 * Normalize model JSON into { sourceId -> targets[] }.
 * @param {Object|Array|null} parsed
 * @param {Object.<string, string>} allowedLowerToCanon
 * @returns {Object.<string, Array>}
 */
function normalizeSuggestionMap(parsed, allowedLowerToCanon) {
    var map = {};
    var list = [];
    if (!parsed) return map;
    if (Array.isArray(parsed)) {
        list = parsed;
    } else if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
        list = parsed.suggestions;
    } else {
        return map;
    }
    var i;
    for (i = 0; i < list.length; i++) {
        var row = list[i];
        if (!row) continue;
        var sourceId = String(row.sourceId || row.id || '').trim();
        if (!sourceId) continue;
        var targets = filterTargets(row.targets || row.suggestions || [], allowedLowerToCanon);
        if (targets.length) {
            map[sourceId] = targets;
        }
    }
    return map;
}

/**
 * @param {Array} fields - create candidates
 * @param {Array<string>} allowedIds
 * @returns {{role: string, content: string}[]}
 */
function buildMessages(fields, allowedIds) {
    var payload = [];
    var i;
    for (i = 0; i < fields.length; i++) {
        var f = fields[i];
        payload.push({
            sourceId:   f.id,
            label:      f.label || f.id,
            sourceType: f.sourceType || f.ctpType || ''
        });
    }
    var system = 'You map source commerce attributes to Salesforce B2C Commerce (SFCC) '
        + 'system (OOTB) attribute ids that are still available. Respond with JSON only, no markdown. '
        + 'Schema: {"suggestions":[{"sourceId":"...","targets":[{"sfccField":"...","confidence":0.0-1.0,"reason":"..."}]}]}. '
        + 'Only suggest sfccField values from the allowed list (already-mapped SFCC fields are omitted). '
        + 'If none fit, omit that source or return an empty targets array. '
        + 'Do not invent SFCC ids. Prefer semantic matches among available fields.';
    var user = 'Allowed (unmapped) SFCC system attribute ids:\n'
        + JSON.stringify(allowedIds)
        + '\n\nSource create-candidate attributes:\n'
        + JSON.stringify(payload);
    return [
        { role: 'system', content: system },
        { role: 'user', content: user }
    ];
}

/**
 * Ask OpenAI for possible SFCC system mappings for create candidates.
 * @param {Object} opts
 * @param {Array} opts.missing - create candidates from classifyFields
 * @param {string} opts.taskName
 * @param {string} [opts.platformId]
 * @param {Array<{id: string}>} [opts.liveSystemAttrs]
 * @param {Array<string>} [opts.excludeSfccFields] - already mapped SFCC system ids from Check UI
 * @returns {{ suggested: Array, aiStatus: string, aiMessage: string }}
 */
function suggestSystemMaps(opts) {
    opts = opts || {};
    var missing = opts.missing || [];
    var empty = { suggested: [], aiStatus: 'skipped', aiMessage: '' };

    if (!missing.length) {
        return empty;
    }
    if (!openAiClient.isConfigured()) {
        return {
            suggested: [],
            aiStatus: 'skipped',
            aiMessage: 'OpenAI suggestions disabled or API key missing'
        };
    }

    var allowedIds = buildAllowedSystemIds(
        opts.taskName,
        opts.liveSystemAttrs,
        opts.platformId,
        opts.excludeSfccFields
    );
    if (!allowedIds.length) {
        return {
            suggested: [],
            aiStatus: 'skipped',
            aiMessage: 'No free SFCC system attributes left for AI suggestions (all claimed by curated maps)'
        };
    }
    var allowedLower = toLowerIndex(allowedIds);
    var suggestedById = {};
    var aiStatus = 'ok';
    var aiMessage = '';
    var offset = 0;

    while (offset < missing.length) {
        var batch = missing.slice(offset, offset + BATCH_SIZE);
        offset += BATCH_SIZE;
        var result = openAiClient.chatCompletions(buildMessages(batch, allowedIds), {
            temperature: 0
        });
        if (!result.ok) {
            aiStatus = 'error';
            aiMessage = result.error || 'OpenAI request failed';
            Logger.warn('suggestSystemMaps failed: {0}', aiMessage);
            break;
        }
        var batchMap = normalizeSuggestionMap(result.parsed, allowedLower);
        var keys = Object.keys(batchMap);
        var k;
        for (k = 0; k < keys.length; k++) {
            suggestedById[keys[k]] = batchMap[keys[k]];
        }
    }

    var suggested = [];
    var i;
    for (i = 0; i < missing.length; i++) {
        var field = missing[i];
        var sid = field && field.id ? String(field.id) : '';
        var targets = sid && suggestedById[sid] ? suggestedById[sid] : null;
        if (!targets || !targets.length) continue;
        suggested.push({
            id:         field.id,
            label:      field.label || field.id,
            sourceType: field.sourceType || field.ctpType || '',
            ctpType:    field.ctpType || field.sourceType || '',
            sfccType:   field.sfccType,
            sfccTypeOptions: field.sfccTypeOptions,
            targets:    targets,
            status:     'suggested'
        });
    }

    if (aiStatus === 'ok' && !suggested.length && !aiMessage) {
        aiMessage = 'No AI system-mapping suggestions for create candidates';
    }

    return {
        suggested:  suggested,
        aiStatus:   aiStatus,
        aiMessage:  aiMessage
    };
}

module.exports = {
    BATCH_SIZE:             BATCH_SIZE,
    buildAllowedSystemIds:  buildAllowedSystemIds,
    filterTargets:          filterTargets,
    normalizeSuggestionMap: normalizeSuggestionMap,
    suggestSystemMaps:      suggestSystemMaps
};
