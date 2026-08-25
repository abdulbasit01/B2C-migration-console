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
    allowedTypesForField:        allowedTypesForField,
    isCompatible:                isCompatible,
    filterPendingByType:         filterPendingByType,
    attachMappableSystemFields:  attachMappableSystemFields
};
