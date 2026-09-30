'use strict';

/**
 * Parse a request-supplied variation attribute selection.
 * Missing input remains null (use the existing default behavior); an explicit
 * empty JSON array remains [] (include no optional attributes).
 *
 * @param {string|null|undefined} raw JSON array from the request
 * @returns {Array<string>|null} normalized, de-duplicated selection
 */
function parse(raw) {
    if (raw === null || raw === undefined || raw === '') return null;

    var parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) {
        throw new Error('attrs must be a JSON array');
    }

    var selected = [];
    var seen = {};
    for (var i = 0; i < parsed.length; i++) {
        if (typeof parsed[i] !== 'string') continue;
        var name = parsed[i].trim();
        if (!name || Object.prototype.hasOwnProperty.call(seen, name)) continue;
        seen[name] = true;
        selected.push(name);
    }
    return selected;
}

module.exports = { parse: parse };
