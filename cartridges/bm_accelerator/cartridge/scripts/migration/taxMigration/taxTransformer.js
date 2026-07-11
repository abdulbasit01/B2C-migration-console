'use strict';

function getLocalized(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return obj.en || obj['en-US'] || obj['en-GB'] || obj.default
        || (Object.keys(obj).length > 0 ? obj[Object.keys(obj)[0]] : '') || '';
}

function sanitizeId(str) {
    if (!str) return '';
    return String(str)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 60);
}

function formatAmount(amount) {
    if (amount === null || amount === undefined || amount === '') return '0';
    var n = Number(amount);
    if (isNaN(n)) return '0';
    return n.toFixed(4).replace(/\.?0+$/, '') || '0';
}

function jurisdictionId(country, state) {
    if (!state) return country;
    return country + '-' + state;
}

function categoryMatches(cat, scopeId) {
    if (!scopeId) return false;
    var key = cat.key || '';
    var id  = cat.id  || '';
    return key === scopeId || id === scopeId || sanitizeId(key) === sanitizeId(scopeId);
}

/**
 * Build canonical tax model from CTP tax categories.
 * @param {Array} categories
 * @param {{ type: string, id: string }} filter
 * @returns {{ taxClasses: Array, jurisdictions: Array, taxRates: Array }}
 */
function buildTaxModel(categories, filter) {
    var scopeType     = (filter && filter.type) ? filter.type : 'full';
    var scopeId       = (filter && filter.id) ? filter.id : '';
    var classMap      = {};
    var jurisMap      = {};
    var taxRates      = [];
    var defaultClass  = '';
    var ci;
    var ri;

    for (ci = 0; ci < categories.length; ci++) {
        var cat     = categories[ci];
        var classId = sanitizeId(cat.key || cat.id);
        if (!classId) continue;

        if (scopeType === 'category' && scopeId && !categoryMatches(cat, scopeId)) {
            continue;
        }

        var className = getLocalized(cat.name) || classId;
        var classDesc = cat.description || ('Commercetools tax category ' + classId);
        var isDefault = (cat.key === 'standard' || classId === 'standard');

        if (!classMap[classId]) {
            classMap[classId] = {
                id:          classId,
                displayName: className,
                description: classDesc,
                isDefault:   isDefault
            };
            if (isDefault || !defaultClass) {
                defaultClass = classId;
            }
        }

        var rates = cat.rates || [];
        for (ri = 0; ri < rates.length; ri++) {
            var rate    = rates[ri];
            var country = rate.country || '';
            if (!country) continue;

            if (scopeType === 'country' && scopeId && country !== scopeId) {
                continue;
            }

            var state = rate.state || '';
            var jId   = jurisdictionId(country, state);

            if (!jurisMap[jId]) {
                jurisMap[jId] = {
                    id:          jId,
                    displayName: state ? (country + ' ' + state) : country,
                    country:     country,
                    stateKey:    state || '-'
                };
            }

            taxRates.push({
                jurisdictionId: jId,
                classId:        classId,
                amount:         formatAmount(rate.amount)
            });
        }
    }

    if (scopeType === 'country' && scopeId) {
        var usedClasses = {};
        var ti;
        for (ti = 0; ti < taxRates.length; ti++) {
            usedClasses[taxRates[ti].classId] = true;
        }
        var keys = Object.keys(classMap);
        for (ci = 0; ci < keys.length; ci++) {
            if (!usedClasses[keys[ci]]) {
                delete classMap[keys[ci]];
            }
        }
    }

    var taxClasses = [];
    var classKeys  = Object.keys(classMap).sort();
    for (ci = 0; ci < classKeys.length; ci++) {
        var cls = classMap[classKeys[ci]];
        cls.isDefault = (cls.id === defaultClass);
        taxClasses.push(cls);
    }

    var jurisdictions = [];
    var jurisKeys = Object.keys(jurisMap).sort();
    for (ci = 0; ci < jurisKeys.length; ci++) {
        jurisdictions.push(jurisMap[jurisKeys[ci]]);
    }

    return {
        taxClasses:    taxClasses,
        jurisdictions: jurisdictions,
        taxRates:      taxRates
    };
}

module.exports = {
    buildTaxModel: buildTaxModel,
    sanitizeId:    sanitizeId,
    formatAmount:  formatAmount
};
