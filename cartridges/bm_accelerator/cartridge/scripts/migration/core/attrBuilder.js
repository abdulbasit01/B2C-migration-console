'use strict';

/**
 * Shared utilities for building SFCC attribute definition payloads.
 * All platform connectors use these to produce a consistent output shape.
 */

/**
 * Extract a display string from a CTP/Shopify localised string or a plain string.
 * @param {Object|string} obj
 * @returns {string}
 */
function toLabel(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    return obj.en || obj['en-US'] || Object.keys(obj).map(function (k) { return obj[k]; })[0] || '';
}

/**
 * Build the SFCC OCAPI attribute definition payload.
 * @param {string} id        - attribute ID (must be a valid SFCC identifier)
 * @param {string} valueType - SFCC value_type (string, int, double, boolean, date, datetime, set_of_string)
 * @param {string} label     - human-readable display name
 * @returns {Object}
 */
function buildAttrDefinition(id, valueType, label) {
    return {
        id:                  id,
        value_type:          valueType,
        mandatory:           false,
        searchable:          false,
        externally_defined:  false,
        externally_managed:  false,
        order_required:      false,
        display_name:        { default: label || id }
    };
}

module.exports = { toLabel: toLabel, buildAttrDefinition: buildAttrDefinition };
