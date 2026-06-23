'use strict';

/**
 * Extract display text from a commercetools LocalizedString, nested object, or plain value.
 * @param {*} value
 * @param {string} [fallback]
 * @returns {string}
 */
function localizedString(value, fallback) {
    if (value === null || value === undefined) return fallback || '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value !== 'object') return fallback || '';

    if (value.label !== undefined && value.label !== null) {
        var fromLabel = localizedString(value.label, '');
        if (fromLabel) return fromLabel;
    }
    if (value.text !== undefined && value.text !== null) {
        var fromText = localizedString(value.text, '');
        if (fromText) return fromText;
    }
    if (value.value !== undefined && value.value !== null) {
        var fromValue = localizedString(value.value, '');
        if (fromValue) return fromValue;
    }

    var locales = ['en', 'en-US', 'en-GB', 'en-AU', 'de', 'fr'];
    var i;
    for (i = 0; i < locales.length; i++) {
        if (value[locales[i]] !== undefined && value[locales[i]] !== null) {
            var preferred = localizedString(value[locales[i]], '');
            if (preferred) return preferred;
        }
    }

    if (typeof value.length === 'number') {
        for (i = 0; i < value.length; i++) {
            var fromArray = localizedString(value[i], '');
            if (fromArray) return fromArray;
            if (value[i] && value[i].locale !== undefined && value[i].value !== undefined) {
                fromArray = localizedString(value[i].value, '');
                if (fromArray) return fromArray;
            }
        }
    }

    var keys = Object.keys(value);
    for (i = 0; i < keys.length; i++) {
        var entry = value[keys[i]];
        if (entry !== undefined && entry !== null) {
            var text = localizedString(entry, '');
            if (text) return text;
        }
    }

    return fallback || '';
}

module.exports = {
    localizedString: localizedString
};
