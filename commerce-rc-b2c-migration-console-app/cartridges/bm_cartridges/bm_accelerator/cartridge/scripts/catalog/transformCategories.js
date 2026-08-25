'use strict';

var Logger = require('dw/system/Logger');

/**
 * Resolves the best available name from a CT localized string object.
 * CT uses en-US / en-GB / de-DE — not plain 'en'.
 * Priority: defaultLocale exact → en-US → en-GB → first available
 */
function resolveLocale(localizedObj, defaultLocale) {
    if (!localizedObj) return '';

    // 1. Exact match
    if (localizedObj[defaultLocale]) return defaultLocale;

    // 2. Language-prefix match: 'en' matches 'en-US', 'en-GB' etc.
    var keys    = Object.keys(localizedObj);
    var prefix  = defaultLocale.split('-')[0]; // 'en-US' -> 'en', 'en' -> 'en'

    for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(prefix + '-') === 0 || keys[i] === prefix) {
            return keys[i];
        }
    }

    // 3. Fallback: en-US, en-GB, then first available
    if (localizedObj['en-US']) return 'en-US';
    if (localizedObj['en-GB']) return 'en-GB';
    return keys[0] || '';
}

function localizedFallback(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return obj.en || obj['en-US'] || obj['en-GB']
        || (Object.keys(obj).length ? obj[Object.keys(obj)[0]] : '');
}

/**
 * Serialize a raw CT custom-Type field value (merchant-defined) for
 * SFCC category custom-attributes. Mirrors inventoryTransformer's approach.
 * @param {*} val
 * @returns {string}
 */
function formatCustomFieldValue(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'boolean' || typeof val === 'number') return String(val);
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) {
        var parts = [];
        for (var ai = 0; ai < val.length; ai++) {
            var item = formatCustomFieldValue(val[ai]);
            if (item) parts.push(item);
        }
        return parts.join(',');
    }
    if (typeof val === 'object') {
        if (val.centAmount !== undefined && val.currencyCode) {
            var digits = typeof val.fractionDigits === 'number' ? val.fractionDigits : 2;
            return (val.centAmount / Math.pow(10, digits)).toFixed(digits) + ' ' + val.currencyCode;
        }
        if (val.id && (val.typeId || val.type_id)) {
            return String(val.id);
        }
        var localized = localizedFallback(val);
        if (localized) return localized;
        try {
            return JSON.stringify(val);
        } catch (e) {
            return '';
        }
    }
    return String(val);
}

/**
 * Transforms a CT category into SFCC-compatible object.
 * @param {Object} ctCategory   - raw CT category
 * @param {String} defaultLocale - e.g. 'en'
 * @param {Object} idToKey       - { UUID -> key } map
 */
function transformCategory(ctCategory, defaultLocale, idToKey) {
    var sfccId   = ctCategory.key || ctCategory.id;
    var parentId = 'root';

    if (ctCategory.parent && ctCategory.parent.id) {
        parentId = idToKey[ctCategory.parent.id] || ctCategory.parent.id;
    }

    var sfccCategory = {
        id              : sfccId,
        parentId        : parentId,
        name            : {},
        description     : {},
        pageTitle       : {},
        pageDescription : {},
        pageKeywords    : {},
        pageURL         : {},
        // position: parsed float used for sort comparisons only.
        // positionRaw: the untouched CT orderHint string — parseFloat truncates
        // its precision (orderHint is a string by design, for arbitrary-precision
        // fractional ordering), so the XML must use the raw string, not this number.
        position        : ctCategory.orderHint ? parseFloat(ctCategory.orderHint) : 0,
        positionRaw     : ctCategory.orderHint || null,
        online          : true,
        customAttributes: {}
    };

    // ── name ────────────────────────────────────────────────────────────────
    if (ctCategory.name) {
        var nameKeys = Object.keys(ctCategory.name);
        var defaultNameLocale = resolveLocale(ctCategory.name, defaultLocale);

        nameKeys.forEach(function (locale) {
            // Map the resolved default locale to x-default
            var sfccLocale = (locale === defaultNameLocale) ? 'x-default' : locale;
            sfccCategory.name[sfccLocale] = ctCategory.name[locale];
        });

        // Ensure x-default always exists
        if (!sfccCategory.name['x-default'] && nameKeys.length > 0) {
            sfccCategory.name['x-default'] = ctCategory.name[nameKeys[0]];
        }
    }

    // ── description ─────────────────────────────────────────────────────────
    if (ctCategory.description) {
        var descKeys = Object.keys(ctCategory.description);
        var defaultDescLocale = resolveLocale(ctCategory.description, defaultLocale);

        descKeys.forEach(function (locale) {
            var sfccLocale = (locale === defaultDescLocale) ? 'x-default' : locale;
            sfccCategory.description[sfccLocale] = ctCategory.description[locale];
        });

        if (!sfccCategory.description['x-default'] && descKeys.length > 0) {
            sfccCategory.description['x-default'] = ctCategory.description[descKeys[0]];
        }
    }

    // ── metaTitle ────────────────────────────────────────────────────────────
    if (ctCategory.metaTitle) {
        var titleKeys = Object.keys(ctCategory.metaTitle);
        var defaultTitleLocale = resolveLocale(ctCategory.metaTitle, defaultLocale);

        titleKeys.forEach(function (locale) {
            var sfccLocale = (locale === defaultTitleLocale) ? 'x-default' : locale;
            sfccCategory.pageTitle[sfccLocale] = ctCategory.metaTitle[locale];
        });

        if (!sfccCategory.pageTitle['x-default'] && titleKeys.length > 0) {
            sfccCategory.pageTitle['x-default'] = ctCategory.metaTitle[titleKeys[0]];
        }
    }

    // ── metaDescription ──────────────────────────────────────────────────────
    if (ctCategory.metaDescription) {
        var metaDescKeys = Object.keys(ctCategory.metaDescription);
        var defaultMetaLocale = resolveLocale(ctCategory.metaDescription, defaultLocale);

        metaDescKeys.forEach(function (locale) {
            var sfccLocale = (locale === defaultMetaLocale) ? 'x-default' : locale;
            sfccCategory.pageDescription[sfccLocale] = ctCategory.metaDescription[locale];
        });

        if (!sfccCategory.pageDescription['x-default'] && metaDescKeys.length > 0) {
            sfccCategory.pageDescription['x-default'] = ctCategory.metaDescription[metaDescKeys[0]];
        }
    }

    // ── metaKeywords ─────────────────────────────────────────────────────────
    if (ctCategory.metaKeywords) {
        var keywordsKeys = Object.keys(ctCategory.metaKeywords);
        var defaultKeywordsLocale = resolveLocale(ctCategory.metaKeywords, defaultLocale);

        keywordsKeys.forEach(function (locale) {
            var sfccLocale = (locale === defaultKeywordsLocale) ? 'x-default' : locale;
            sfccCategory.pageKeywords[sfccLocale] = ctCategory.metaKeywords[locale];
        });

        if (!sfccCategory.pageKeywords['x-default'] && keywordsKeys.length > 0) {
            sfccCategory.pageKeywords['x-default'] = ctCategory.metaKeywords[keywordsKeys[0]];
        }
    }

    // ── slug → pageURL, falling back to the category key when unset ─────────
    var resolvedSlug = '';
    if (ctCategory.slug) {
        var slugLocale = resolveLocale(ctCategory.slug, defaultLocale);
        var slugKeys   = Object.keys(ctCategory.slug);

        slugKeys.forEach(function (locale) {
            var sfccLocale = (locale === slugLocale) ? 'x-default' : locale;
            sfccCategory.pageURL[sfccLocale] = ctCategory.slug[locale];
        });

        resolvedSlug = ctCategory.slug[slugLocale]
            || ctCategory.slug['en-US']
            || ctCategory.slug['en-GB']
            || (slugKeys.length > 0 ? ctCategory.slug[slugKeys[0]] : '')
            || '';
    }
    if (!sfccCategory.pageURL['x-default']) {
        sfccCategory.pageURL['x-default'] = resolvedSlug || ctCategory.key || '';
    }

    // Genuine CT Custom Type fields (merchant-defined extensions) — dynamic pass-through.
    if (ctCategory.custom && ctCategory.custom.fields) {
        var ctFieldKeys = Object.keys(ctCategory.custom.fields);
        for (var cfi = 0; cfi < ctFieldKeys.length; cfi++) {
            var formattedCf = formatCustomFieldValue(ctCategory.custom.fields[ctFieldKeys[cfi]]);
            if (formattedCf !== '') {
                sfccCategory.customAttributes[ctFieldKeys[cfi]] = formattedCf;
            }
        }
    }

    return sfccCategory;
}

/**
 * Transforms flat CT category list into sorted SFCC array.
 * @param {Array}  ctCategories
 * @param {String} defaultLocale - e.g. 'en' (will match en-US, en-GB)
 * @returns {Array} sorted SFCC categories (parents before children)
 */
function transformAll(ctCategories, defaultLocale) {
    defaultLocale = defaultLocale || 'en';

    // Build UUID -> key map for parent resolution
    var idToKey = {};
    ctCategories.forEach(function (cat) {
        if (cat.key) {
            idToKey[cat.id] = cat.key;
        }
    });

    var sfccCategories = ctCategories.map(function (cat) {
        return transformCategory(cat, defaultLocale, idToKey);
    });

    // Sort by depth — parents must come before children in XML
    var idMap = {};
    sfccCategories.forEach(function (cat) { idMap[cat.id] = cat; });

    function getDepth(cat, visited) {
        visited = visited || {};
        if (visited[cat.id]) return 0;
        visited[cat.id] = true;
        if (!cat.parentId || cat.parentId === 'root') return 0;
        var parent = idMap[cat.parentId];
        return parent ? 1 + getDepth(parent, visited) : 1;
    }

    sfccCategories.sort(function (a, b) {
        var depthA = getDepth(a);
        var depthB = getDepth(b);
        if (depthA !== depthB) return depthA - depthB;
        if (a.parentId === b.parentId) return (a.position || 0) - (b.position || 0);
        return 0;
    });

    Logger.info('transformAll: {0} categories transformed', sfccCategories.length);
    return sfccCategories;
}

/**
 * CT category UUID → SFCC category-id (key when present, else UUID).
 * Same ID scheme as transformCategory / catalog XML.
 * @param {Array} ctCategories
 * @returns {Object.<string, string>}
 */
function buildIdToSfccIdMap(ctCategories) {
    var map = {};
    var list = ctCategories || [];
    var i;
    for (i = 0; i < list.length; i++) {
        var cat = list[i];
        if (!cat || !cat.id) continue;
        map[cat.id] = cat.key || cat.id;
    }
    return map;
}

module.exports = {
    transformCategory : transformCategory,
    transformAll      : transformAll,
    buildIdToSfccIdMap: buildIdToSfccIdMap
};