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
        position        : ctCategory.orderHint ? parseFloat(ctCategory.orderHint) : 0,
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

    // ── ctSlug: localized slug → fall back to category key ──────────────────
    var resolvedSlug = '';
    if (ctCategory.slug) {
        var slugLocale = resolveLocale(ctCategory.slug, defaultLocale);
        var slugKeys   = Object.keys(ctCategory.slug);
        resolvedSlug = ctCategory.slug[slugLocale]
            || ctCategory.slug['en-US']
            || ctCategory.slug['en-GB']
            || (slugKeys.length > 0 ? ctCategory.slug[slugKeys[0]] : '')
            || '';
    }
    sfccCategory.customAttributes.ctSlug     = resolvedSlug || ctCategory.key || '';
    sfccCategory.customAttributes.ctId       = ctCategory.id || '';
    sfccCategory.customAttributes.ctPosition = ctCategory.orderHint ? parseFloat(ctCategory.orderHint) : sfccCategory.position;

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