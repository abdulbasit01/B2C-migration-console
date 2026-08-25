'use strict';

var X_DEFAULT_PRIORITY = ['en-US', 'en', 'en-GB', 'x-default'];

/**
 * Map CT locale keys to SFCC IMPEX xml:lang values.
 * @param {string} ctpLocale
 * @returns {string}
 */
function normalizeSfccLocale(ctpLocale) {
    var loc = String(ctpLocale || '').trim();
    if (!loc || loc === 'x-default') return 'x-default';
    if (loc === 'en' || loc === 'en-US' || loc === 'en-GB') return 'x-default';
    return loc;
}

/**
 * @param {Object|string|null|undefined} obj
 * @param {string} [fallback]
 * @returns {Array<{lang: string, value: string}>}
 */
function collectLocalizedEntries(obj, fallback) {
    var byLang = {};

    function addEntry(rawLang, val) {
        if (val === null || val === undefined || val === '') return;
        if (typeof val === 'object') return;
        var lang = normalizeSfccLocale(rawLang);
        var text = String(val).trim();
        if (!text) return;
        if (!byLang[lang]) {
            byLang[lang] = text;
        }
    }

    if (typeof obj === 'string') {
        var trimmed = obj.trim();
        if (trimmed) return [{ lang: 'x-default', value: trimmed }];
    } else if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        var keys = Object.keys(obj);
        var pi;
        for (pi = 0; pi < X_DEFAULT_PRIORITY.length; pi++) {
            if (Object.prototype.hasOwnProperty.call(obj, X_DEFAULT_PRIORITY[pi])) {
                addEntry(X_DEFAULT_PRIORITY[pi], obj[X_DEFAULT_PRIORITY[pi]]);
            }
        }
        for (var i = 0; i < keys.length; i++) {
            if (X_DEFAULT_PRIORITY.indexOf(keys[i]) >= 0) continue;
            addEntry(keys[i], obj[keys[i]]);
        }
    }

    var entries = [];
    var langs   = Object.keys(byLang);
    for (var j = 0; j < langs.length; j++) {
        entries.push({ lang: langs[j], value: byLang[langs[j]] });
    }

    entries.sort(function (a, b) {
        if (a.lang === 'x-default') return -1;
        if (b.lang === 'x-default') return 1;
        return a.lang < b.lang ? -1 : (a.lang > b.lang ? 1 : 0);
    });

    if (!entries.length && fallback) {
        entries.push({ lang: 'x-default', value: String(fallback) });
    }
    return entries;
}

function primaryLocalized(entries) {
    if (!entries || !entries.length) return '';
    for (var i = 0; i < entries.length; i++) {
        if (entries[i].lang === 'x-default') return entries[i].value;
    }
    return entries[0].value;
}

function localizedValue(obj, fallback) {
    return primaryLocalized(collectLocalizedEntries(obj, fallback));
}

function isLocalizedObject(val) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
    var keys = Object.keys(val);
    if (!keys.length) return false;
    for (var i = 0; i < keys.length; i++) {
        var v = val[keys[i]];
        if (v !== null && v !== undefined && typeof v === 'object') return false;
    }
    return true;
}

function moneyToDecimal(money) {
    if (!money || money.centAmount === undefined || money.centAmount === null) return 0;
    var fraction = money.fractionDigits || 2;
    return money.centAmount / Math.pow(10, fraction);
}

function sanitizeMethodId(ctpMethod) {
    if (ctpMethod.key) {
        return String(ctpMethod.key).replace(/[^A-Za-z0-9_-]/g, '_').substring(0, 256);
    }
    if (ctpMethod.name) {
        return String(ctpMethod.name).replace(/[^A-Za-z0-9_-]/g, '_').substring(0, 256);
    }
    return String(ctpMethod.id || 'ctp-shipping').replace(/-/g, '').substring(0, 256);
}

function extractPriceInfo(ctpMethod) {
    var zoneRates = ctpMethod.zoneRates || [];
    for (var z = 0; z < zoneRates.length; z++) {
        var rates = zoneRates[z].shippingRates || [];
        for (var r = 0; r < rates.length; r++) {
            var rate = rates[r];
            if (rate.price) {
                return {
                    price:    moneyToDecimal(rate.price),
                    currency: rate.price.currencyCode || 'USD'
                };
            }
            if (rate.tiers && rate.tiers.length && rate.tiers[0].value) {
                return {
                    price:    moneyToDecimal(rate.tiers[0].value),
                    currency: rate.tiers[0].value.currencyCode || 'USD'
                };
            }
        }
    }
    return { price: 0, currency: 'USD' };
}

/**
 * Transform a CT shipping method into SFCC shipping method payload.
 * @param {Object} ctpMethod
 * @returns {Object}
 */
function transformShippingMethod(ctpMethod) {
    if (!ctpMethod || !ctpMethod.id) {
        throw new Error('CT shipping method missing id');
    }

    var priceInfo      = extractPriceInfo(ctpMethod);
    var displayNames   = collectLocalizedEntries(
        ctpMethod.localizedName,
        ctpMethod.name || ctpMethod.key || ctpMethod.id
    );
    var descriptions   = collectLocalizedEntries(
        ctpMethod.localizedDescription,
        ctpMethod.description || ''
    );
    var method = {
        method_id:       sanitizeMethodId(ctpMethod),
        display_names:   displayNames,
        descriptions:    descriptions,
        display_name:    primaryLocalized(displayNames),
        description:     primaryLocalized(descriptions),
        online_flag:     ctpMethod.active !== false,
        is_default:      !!ctpMethod.isDefault,
        tax_class_id:    'standard',
        price:           priceInfo.price,
        currency:        priceInfo.currency,
        localized_custom: []
    };

    if (ctpMethod.custom && ctpMethod.custom.fields) {
        var attrIdMapSession = require('*/cartridge/scripts/migration/core/attrIdMapSession');
        var attrMap = attrIdMapSession.read('shippingMethod');
        var fields = ctpMethod.custom.fields;
        var keys   = Object.keys(fields);
        for (var i = 0; i < keys.length; i++) {
            var fk = keys[i];
            var fv = fields[fk];
            if (fv === null || fv === undefined) continue;
            var sfccFk = attrIdMapSession.resolve(fk, attrMap);
            if (isLocalizedObject(fv)) {
                var entries = collectLocalizedEntries(fv, '');
                if (entries.length) {
                    method.localized_custom.push({ id: sfccFk, entries: entries });
                }
            } else if (typeof fv !== 'object') {
                method['c_' + sfccFk] = fv;
            }
        }
    }

    return method;
}

/**
 * CT key or UUID used to fetch/migrate one shipping method.
 * @param {Object} ctpMethod
 * @returns {string}
 */
function toMigrationRef(ctpMethod) {
    if (!ctpMethod) return '';
    return ctpMethod.key || ctpMethod.id || '';
}

/**
 * Lightweight summary for the migration UI checklist.
 * @param {Object} ctpMethod
 * @returns {Object}
 */
function toSummary(ctpMethod) {
    var method = transformShippingMethod(ctpMethod);
    return {
        ref:          toMigrationRef(ctpMethod),
        key:          ctpMethod.key || '',
        id:           ctpMethod.id,
        name:         method.display_name,
        active:       method.online_flag,
        isDefault:    method.is_default,
        sfccMethodId: method.method_id
    };
}

module.exports = {
    transformShippingMethod: transformShippingMethod,
    toMigrationRef:          toMigrationRef,
    toSummary:               toSummary,
    collectLocalizedEntries:   collectLocalizedEntries,
    primaryLocalized:          primaryLocalized,
    localizedValue:            localizedValue
};

