'use strict';

/**
 * Generic detector that flags when a source field (standard field or custom
 * field/metafield, from any connector) plausibly duplicates an SFCC system
 * (built-in) attribute — e.g. Shopify's "phone"/"shopify_phone" vs SFCC's
 * native phoneMobile.
 *
 * Unlike nativeFieldMap.json (curated, exact rules), this works off the live
 * SFCC attribute list so it catches fields nobody has explicitly mapped yet,
 * including store-specific metafields/custom fields.
 */

var MIN_TOKEN_LENGTH = 3; // ignore tokens shorter than this — too many false positives (e.g. "id", "no")

function normalize(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Split an identifier into lowercase word tokens, handling snake_case,
 * kebab-case, spaces, and camelCase boundaries.
 * @param {string} str
 * @returns {Array<string>}
 */
function tokenize(str) {
    return String(str || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^a-zA-Z0-9]+/)
        .map(function (t) { return t.toLowerCase(); })
        .filter(function (t) { return t.length >= MIN_TOKEN_LENGTH; });
}

/**
 * Find SFCC system attributes whose id or display name plausibly correspond
 * to a source field. Exact normalized matches are preferred; otherwise any
 * shared meaningful word token (e.g. "phone" in both "shopify_phone" and
 * "phoneMobile") counts as a match — this is what catches prefixed custom
 * attributes, not just the bare native-equivalent field name.
 * @param {string} sourceId    - source field id/key (e.g. "phone", "shopify_phone")
 * @param {string} [sourceLabel] - source field human label (e.g. "Shopify Phone")
 * @param {Array<{id: string, displayName: string, system: boolean}>} sfccAttrs
 *        - full attribute list for the target SFCC object type (system + custom)
 * @returns {Array<{id: string, displayName: string}>} candidate matches, best first
 */
function findNativeMatches(sourceId, sourceLabel, sfccAttrs) {
    var normId    = normalize(sourceId);
    var normLabel = normalize(sourceLabel);
    var srcTokens = tokenize(sourceId).concat(tokenize(sourceLabel));
    var exact     = [];
    var partial   = [];

    for (var i = 0; i < (sfccAttrs || []).length; i++) {
        var attr = sfccAttrs[i];
        if (!attr.system) continue; // only match against SFCC's own built-in fields

        var attrId = normalize(attr.id);
        if (!attrId) continue;

        if (attrId === normId || (normLabel && attrId === normLabel)) {
            exact.push(attr);
            continue;
        }

        var attrTokens = tokenize(attr.id).concat(tokenize(attr.displayName));
        var sharesToken = false;
        for (var t = 0; t < srcTokens.length && !sharesToken; t++) {
            if (attrTokens.indexOf(srcTokens[t]) !== -1) sharesToken = true;
        }
        if (sharesToken) partial.push(attr);
    }

    return exact.length ? exact : partial;
}

module.exports = { normalize: normalize, tokenize: tokenize, findNativeMatches: findNativeMatches };
