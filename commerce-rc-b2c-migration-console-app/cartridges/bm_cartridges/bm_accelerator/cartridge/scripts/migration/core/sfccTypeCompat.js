'use strict';

/**
 * Type compatibility for mapping a source create-candidate onto an existing
 * SFCC system attribute. A source may map to a system field when the field's
 * value_type is in the source's allowed SFCC types (resolved type + create
 * options), expanded by a small family (string↔text↔html, int↔double).
 */

var FAMILIES = {
    string:         ['string', 'text', 'html', 'email'],
    text:           ['string', 'text', 'html', 'email'],
    html:           ['string', 'text', 'html', 'email'],
    email:          ['string', 'text', 'html', 'email'],
    int:            ['int', 'double'],
    double:         ['double', 'int'],
    boolean:        ['boolean'],
    date:           ['date'],
    datetime:       ['datetime'],
    image:          ['image'],
    password:       ['password'],
    set_of_string:  ['set_of_string'],
    set_of_int:     ['set_of_int'],
    set_of_double:  ['set_of_double'],
    enum_of_string: ['enum_of_string', 'string'],
    enum_of_int:    ['enum_of_int', 'int']
};

/**
 * @param {string} valueType
 * @returns {string}
 */
function normalize(valueType) {
    return String(valueType || '').trim().toLowerCase();
}

/**
 * Normalize an attribute id for deterministic cross-platform comparisons.
 * productName, product_name and product-name all normalize to productname.
 * @param {string} attrId
 * @returns {string}
 */
function normalizeAttrId(attrId) {
    return String(attrId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * @param {Object.<string, boolean>} set
 * @param {string} valueType
 */
function addAllowed(set, valueType) {
    var t = normalize(valueType);
    if (!t) return;
    set[t] = true;
    var family = FAMILIES[t];
    var i;
    if (family) {
        for (i = 0; i < family.length; i++) {
            set[family[i]] = true;
        }
    }
}

/**
 * Allowed SFCC value_type ids for a create-candidate field.
 * @param {{ sfccType?: string, sfccTypeOptions?: Array }} field
 * @returns {Object.<string, boolean>}
 */
function allowedTypesForField(field) {
    var set = {};
    var opts;
    var i;
    var opt;
    if (!field) return set;
    addAllowed(set, field.sfccType);
    opts = field.sfccTypeOptions || [];
    for (i = 0; i < opts.length; i++) {
        opt = opts[i];
        addAllowed(set, opt && (opt.value || opt));
    }
    return set;
}

/**
 * @param {{ sfccType?: string, sfccTypeOptions?: Array }} field
 * @param {string} systemValueType
 * @returns {boolean}
 */
function isCompatible(field, systemValueType) {
    var sys = normalize(systemValueType);
    if (!sys) return false;
    var allowed = allowedTypesForField(field);
    return !!allowed[sys];
}

/**
 * @param {{ sfccType?: string, sfccTypeOptions?: Array }} field
 * @param {Array<{ id: string, valueType?: string }>} pending
 * @returns {Array}
 */
function filterPendingByType(field, pending) {
    var out = [];
    var i;
    var p;
    for (i = 0; i < (pending || []).length; i++) {
        p = pending[i];
        if (p && isCompatible(field, p.valueType)) {
            out.push(p);
        }
    }
    return out;
}

/**
 * Existing custom targets must be type compatible. A localized source cannot
 * be mapped to an explicitly non-localizable target without losing locales.
 * @param {Object} field
 * @param {{valueType?: string, localizable?: boolean|null}} target
 * @returns {boolean}
 */
function isCustomTargetCompatible(field, target) {
    if (!field || !target || !isCompatible(field, target.valueType)) return false;
    var sourceLocalized = !!(field.sourceLocalizable || field.localizable || field.scope === 'localized');
    if (sourceLocalized && target.localizable === false) return false;
    return true;
}

/**
 * Attach compatible existing SFCC custom attributes to each create candidate.
 * A normalized id match is marked as recommended but still requires user confirmation.
 * @param {Array<Object>} missing
 * @param {Array<{id: string, displayName?: string, valueType?: string, localizable?: boolean|null}>} customAttrs
 */
function attachMappableCustomFields(missing, customAttrs) {
    var i;
    var c;
    for (i = 0; i < (missing || []).length; i++) {
        var field = missing[i];
        if (!field) continue;
        var sourceNorm = normalizeAttrId(field.id);
        var targets = [];
        for (c = 0; c < (customAttrs || []).length; c++) {
            var target = customAttrs[c];
            if (!target || !target.id || target.id === field.id) continue;
            if (!isCustomTargetCompatible(field, target)) continue;
            targets.push({
                id:              target.id,
                displayName:     target.displayName || target.id,
                valueType:       target.valueType || '',
                localizable:     target.localizable,
                normalizedMatch: !!sourceNorm && sourceNorm === normalizeAttrId(target.id)
            });
        }
        targets.sort(function (a, b) {
            if (a.normalizedMatch !== b.normalizedMatch) return a.normalizedMatch ? -1 : 1;
            var aid = String(a.id).toLowerCase();
            var bid = String(b.id).toLowerCase();
            if (aid === bid) return 0;
            return aid < bid ? -1 : 1;
        });
        field.mappableCustomFields = targets;
        field.suggestedCustomField = targets.length && targets[0].normalizedMatch
            ? targets[0].id
            : '';
    }
}

/**
 * @param {Array<{ sfccType?: string, sfccTypeOptions?: Array }>} missing
 * @param {Array<{ id: string, valueType?: string }>} pending
 * @param {boolean} anyTyped - false → do not filter (no live types available)
 */
function attachMappableSystemFields(missing, pending, anyTyped) {
    var i;
    var m;
    var compatible;
    var ids;
    var c;
    for (i = 0; i < (missing || []).length; i++) {
        m = missing[i];
        if (!m) continue;
        if (!anyTyped) {
            ids = [];
            for (c = 0; c < (pending || []).length; c++) {
                if (pending[c] && pending[c].id) ids.push(pending[c].id);
            }
            m.mappableSystemFields = ids;
            continue;
        }
        compatible = filterPendingByType(m, pending);
        ids = [];
        for (c = 0; c < compatible.length; c++) {
            if (compatible[c].id) ids.push(compatible[c].id);
        }
        m.mappableSystemFields = ids;
    }
}

module.exports = {
    normalizeAttrId:             normalizeAttrId,
    allowedTypesForField:        allowedTypesForField,
    isCompatible:                isCompatible,
    filterPendingByType:         filterPendingByType,
    isCustomTargetCompatible:    isCustomTargetCompatible,
    attachMappableSystemFields:  attachMappableSystemFields,
    attachMappableCustomFields:  attachMappableCustomFields
};
