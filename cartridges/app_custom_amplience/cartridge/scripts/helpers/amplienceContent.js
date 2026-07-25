'use strict';

var ContentMgr = require('dw/content/ContentMgr');
var Site = require('dw/system/Site');

var FOLDER_ID = 'amplience';
var WIDGET_TYPES = {
    campaignBanner: 'campaignBanner',
    editorialRichText: 'editorialRichText',
    mainBanner: 'mainBanner',
    imageAndText: 'imageAndText',
    amplienceWidget: 'amplienceWidget'
};

/**
 * Parse a JSON custom attribute without failing the storefront request.
 * @param {*} raw - JSON value
 * @param {*} fallback - Value returned when parsing fails
 * @returns {*} Parsed value or fallback
 */
function parseJsonSafe(raw, fallback) {
    if (raw == null || raw === '') return fallback == null ? null : fallback;
    try {
        return JSON.parse(String(raw));
    } catch (e) {
        return fallback == null ? null : fallback;
    }
}

/**
 * Determine whether markup contains visible text.
 * @param {string} value - HTML markup
 * @returns {boolean} Whether markup has visible content
 */
function isMeaningfulMarkup(value) {
    return String(value || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, '')
        .replace(/\s/g, '')
        .length > 0;
}

/**
 * Build an image URL from an Amplience image object.
 * @param {*} value - Possible image value
 * @returns {string} Image URL
 */
function getImageUrl(value) {
    if (!value) return '';
    if (typeof value === 'string') {
        if (!/^(https?:)?\/\//.test(value)) return '';
        // Reject HTML docs / pages that were mistakenly stored as image URLs.
        if (/\.html?(?:\?|#|$)/i.test(value) || /\/guide\//i.test(value)) return '';
        return value;
    }
    if (value.di) return String(value.di);
    if (value.url) return getImageUrl(String(value.url));
    if (value.src) return getImageUrl(String(value.src));
    if (value.defaultHost && value.endpoint && value.name) {
        return 'https://' + value.defaultHost + '/i/' + value.endpoint + '/' + value.name;
    }
    return '';
}

/**
 * Whether a preview field can be rendered in the storefront templates.
 * @param {Object} field - Preview field
 * @returns {boolean} True when the field has a visible text/image value
 */
function isRenderableField(field) {
    if (!field) return false;
    if (field.type === 'localized' && field.options && field.options.length) return true;
    if (field.value == null || field.value === '') return false;
    var type = String(field.type || 'text');
    return type === 'text' || type === 'image' || type === 'list' || type === 'object';
}

/**
 * Unwrap Amplience delivery / localized wrappers to the content root.
 * @param {Object} source - Parsed amplienceSourceJson
 * @returns {Object} Content root
 */
function getSourceRoot(source) {
    var item = source && source.item ? source.item : source;
    var root = item;

    if (item && item.content && typeof item.content === 'object') {
        root = item.content;
    } else if (item && item.body && typeof item.body === 'object') {
        root = item.body;
    }

    // Amplience core localized-value: { values: [{ locale, value }] }
    if (root && Array.isArray(root.values) && root.values.length) {
        var preferred = null;
        var i;
        for (i = 0; i < root.values.length; i++) {
            var entry = root.values[i];
            if (!entry || entry.value == null) continue;
            if (!preferred) preferred = entry.value;
            var locale = String(entry.locale || '').toLowerCase();
            if (locale.indexOf('en') === 0) {
                preferred = entry.value;
                break;
            }
        }
        if (preferred != null) {
            if (typeof preferred === 'object') return preferred;
            return { value: preferred };
        }
    }

    return root && typeof root === 'object' ? root : {};
}

/**
 * Extract renderable primitive fields from the source JSON.
 * @param {Object} source - Parsed amplienceSourceJson
 * @returns {Array} Preview field models
 */
function scalarToPreviewValue(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (typeof value === 'object') {
        var imageUrl = getImageUrl(value);
        if (imageUrl) return imageUrl;
        var nested = value.richText || value.text || value.title || value.headline || value.body;
        if (typeof nested === 'string') return nested;
        if (Array.isArray(nested)) return String(nested.length) + ' block(s)';
    }
    return '';
}

function isLocalizedValuesEntry(entry) {
    return entry && typeof entry === 'object' && entry.value != null
        && (entry.locale != null || entry.lang != null);
}

function isLocalizedValuesArray(value) {
    if (!Array.isArray(value) || !value.length) return false;
    var i;
    for (i = 0; i < value.length; i++) {
        if (!isLocalizedValuesEntry(value[i])) return false;
    }
    return true;
}

function pushLocalizedField(targetFields, path, valuesArray) {
    var options = [];
    var preferred = null;
    var i;
    var entry;
    var locale;
    var rawValue;
    var previewValue;
    var optType;

    for (i = 0; i < Math.min(valuesArray.length, 12); i++) {
        entry = valuesArray[i];
        locale = String(entry.locale || entry.lang || i);
        rawValue = entry.value;
        previewValue = scalarToPreviewValue(rawValue);
        optType = getImageUrl(rawValue) ? 'image' : 'text';
        if (!previewValue) continue;
        options.push({
            locale: locale,
            label: formatLocaleLabel(locale),
            value: previewValue,
            type: optType
        });
        if (!preferred) preferred = options[options.length - 1];
        if (locale.toLowerCase().indexOf('en') === 0) {
            preferred = options[options.length - 1];
        }
    }

    if (!options.length) return;
    if (options.length === 1) {
        targetFields.push({
            name: path || 'values',
            type: options[0].type,
            value: options[0].value
        });
        return;
    }

    targetFields.push({
        name: path || 'values',
        type: 'localized',
        value: preferred.value,
        options: options
    });
}

function extractSourceFields(source) {
    var root = getSourceRoot(source);
    var fields = [];
    var skipped = { _meta: true, _links: true };

    /**
     * Visit nested content with a conservative depth and item limit.
     * @param {*} value - Current value
     * @param {string} path - Display path
     * @param {number} depth - Current depth
     * @returns {void}
     */
    function visit(value, path, depth) {
        var imageUrl;
        var keys;
        var i;
        var entry;
        var localePath;

        if (fields.length >= 32 || value == null || depth > 6) return;
        if (typeof value === 'string' || typeof value === 'number'
            || typeof value === 'boolean') {
            imageUrl = getImageUrl(value);
            fields.push({
                name: path || 'value',
                type: imageUrl ? 'image' : 'text',
                value: imageUrl || String(value)
            });
            return;
        }
        imageUrl = getImageUrl(value);
        if (imageUrl) {
            fields.push({ name: path || 'image', type: 'image', value: imageUrl });
            return;
        }
        if (Array.isArray(value)) {
            if (isLocalizedValuesArray(value)) {
                pushLocalizedField(fields, path, value);
                return;
            }
            for (i = 0; i < Math.min(value.length, 12); i++) {
                entry = value[i];
                // Localized / keyed list entries often look like { locale, value }
                if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value')
                    && (entry.locale != null || entry.lang != null)) {
                    localePath = path
                        ? path + '[' + String(entry.locale || entry.lang || i) + ']'
                        : String(entry.locale || entry.lang || i);
                    visit(entry.value, localePath, depth + 1);
                } else {
                    visit(entry, path + '[' + i + ']', depth + 1);
                }
            }
            return;
        }
        if (typeof value === 'object') {
            if (isLocalizedValuesArray(value.values)) {
                pushLocalizedField(fields, path ? path + '.values' : 'values', value.values);
                return;
            }
            keys = Object.keys(value);
            for (i = 0; i < keys.length; i++) {
                if (!skipped[keys[i]]) {
                    visit(value[keys[i]], path ? path + '.' + keys[i] : keys[i], depth + 1);
                }
            }
        }
    }

    visit(root || {}, '', 0);
    return fields;
}

function formatLocaleLabel(localeKey) {
    var key = String(localeKey || '').trim();
    if (!key) return 'Value';
    if (/^[a-z]{2}([-_][a-z]{2})?$/i.test(key)) {
        return key.toUpperCase().replace('_', '-');
    }
    if (/^\d+$/.test(key)) {
        return 'Item ' + (parseInt(key, 10) + 1);
    }
    return key;
}

/**
 * Collapse locale- or index-suffixed preview fields into one dropdown row.
 * @param {Array} fields - Flat preview fields
 * @returns {Array} Grouped fields
 */
function groupLocalizedPreviewFields(fields) {
    if (!fields || !fields.length) return [];

    var output = [];
    var groupMap = {};
    var groupOrder = [];
    var i;
    var field;
    var match;
    var baseName;
    var suffix;

    function flushGroups() {
        var g;
        var base;
        var items;
        var preferred;
        var j;

        for (g = 0; g < groupOrder.length; g++) {
            base = groupOrder[g];
            items = groupMap[base];
            if (!items || !items.length) continue;

            if (items.length === 1) {
                output.push({
                    name: base + '[' + items[0].locale + ']',
                    type: items[0].type,
                    value: items[0].value
                });
                continue;
            }

            preferred = items[0];
            for (j = 0; j < items.length; j++) {
                if (String(items[j].locale).toLowerCase().indexOf('en') === 0) {
                    preferred = items[j];
                    break;
                }
            }

            output.push({
                name: base,
                type: 'localized',
                value: preferred.value,
                options: items
            });
        }

        groupMap = {};
        groupOrder = [];
    }

    for (i = 0; i < fields.length; i++) {
        field = fields[i];
        match = String(field.name || '').match(/^(.+)\[([^\]]+)\]$/);
        if (!match) {
            flushGroups();
            output.push(field);
            continue;
        }

        baseName = match[1];
        suffix = match[2];
        if (!groupMap[baseName]) {
            groupMap[baseName] = [];
            groupOrder.push(baseName);
        }
        groupMap[baseName].push({
            locale: suffix,
            label: formatLocaleLabel(suffix),
            value: field.value,
            type: field.type || 'text'
        });
    }

    flushGroups();
    return output;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

function buildLocalizedFieldMarkup(field) {
    var options = field.options || [];
    var html = '<div class="amp-widget-fallback__field amp-widget-fallback__field--localized">';
    var i;
    var first = options[0];

    if (!first) return '';

    html += '<div class="amp-locale-toolbar">';
    html += '<span class="amp-locale-toolbar__label">' + escapeHtml(field.name) + '</span>';
    html += '<select class="amp-locale-select" aria-label="' + escapeHtml(field.name) + ' locale">';
    for (i = 0; i < options.length; i++) {
        html += '<option value="' + i + '" data-type="' + escapeAttr(options[i].type || 'text')
            + '" data-content="' + escapeAttr(options[i].value) + '"'
            + (i === 0 ? ' selected' : '') + '>' + escapeHtml(options[i].label) + '</option>';
    }
    html += '</select>';
    html += '</div>';

    if (first.type === 'image') {
        html += '<div class="amp-locale-display amp-locale-display--image"><figure class="amp-widget-fallback__image"><img src="'
            + escapeHtml(first.value) + '" alt="' + escapeHtml(first.label)
            + '" loading="lazy" /></figure></div>';
    } else {
        html += '<p class="amp-locale-display">' + escapeHtml(first.value) + '</p>';
    }

    html += '</div>';
    return html;
}

/**
 * Build ISML-safe markup for preview fields (avoids nested isloop on options[]).
 * @param {Array} fields - Grouped preview fields
 * @returns {Array} Fields with markup property
 */
function prepareFieldsForView(fields) {
    var prepared = [];
    var i;
    var field;

    for (i = 0; i < (fields || []).length; i++) {
        field = fields[i];
        if (!field) continue;

        if (field.type === 'localized' && field.options && field.options.length) {
            prepared.push({
                name: field.name,
                type: field.type,
                value: field.value,
                options: field.options,
                markup: buildLocalizedFieldMarkup(field)
            });
            continue;
        }

        if (field.type === 'image' && field.value) {
            prepared.push({
                name: field.name,
                type: field.type,
                value: field.value,
                markup: '<figure class="amp-widget-fallback__image"><img src="'
                    + escapeHtml(field.value) + '" alt="' + escapeHtml(field.name)
                    + '" loading="lazy" /></figure>'
            });
            continue;
        }

        if (field.value != null && field.value !== '') {
            prepared.push({
                name: field.name,
                type: field.type || 'text',
                value: field.value,
                markup: '<div class="amp-widget-fallback__field"><span>'
                    + escapeHtml(field.name) + '</span><p>' + escapeHtml(field.value) + '</p></div>'
            });
        }
    }

    return prepared;
}

function countLocaleLikeFields(fieldList) {
    var count = 0;
    var i;
    for (i = 0; i < (fieldList || []).length; i++) {
        if (!fieldList[i]) continue;
        if (fieldList[i].type === 'localized') {
            count += 1;
            continue;
        }
        if (String(fieldList[i].name || '').indexOf('[') >= 0) count += 1;
    }
    return count;
}

function hasSourcePayload(source) {
    var root = getSourceRoot(source);
    return !!(root && typeof root === 'object' && Object.keys(root).length);
}

/**
 * Select normalized preview fields, falling back to source JSON when needed.
 * @param {Object} attributes - Migrated widget attributes
 * @param {Object} source - Parsed amplienceSourceJson
 * @returns {Array} Preview fields
 */
function normalizeFields(attributes, source) {
    return prepareFieldsForView(getGroupedFieldsRaw(attributes, source));
}

/**
 * Group preview fields without view markup (for gallery locale handling).
 * @param {Object} attributes - Migrated widget attributes
 * @param {Object} source - Parsed amplienceSourceJson
 * @returns {Array} Grouped preview fields
 */
function getGroupedFieldsRaw(attributes, source) {
    var fromAttrs = [];
    if (attributes) {
        fromAttrs = attributes.previewFields || attributes.fields || [];
    }
    if (!Array.isArray(fromAttrs)) fromAttrs = [];

    var fromSource = extractSourceFields(source);
    var renderableAttrs = fromAttrs.filter(isRenderableField).filter(function (field) {
        return field.type === 'text' || field.type === 'image';
    });

    if (hasSourcePayload(source)
        && (fromSource.length > renderableAttrs.length
            || countLocaleLikeFields(fromSource) > countLocaleLikeFields(renderableAttrs))) {
        return groupLocalizedPreviewFields(fromSource);
    }
    if (renderableAttrs.length) {
        return groupLocalizedPreviewFields(renderableAttrs);
    }
    return groupLocalizedPreviewFields(fromSource);
}

function normalizeLocaleKey(locale) {
    return String(locale || '').toLowerCase().replace(/_/g, '-');
}

function localeMatches(requested, candidate) {
    var wanted = normalizeLocaleKey(requested);
    var option = normalizeLocaleKey(candidate);
    if (!wanted) return true;
    if (!option) return false;
    return wanted === option
        || wanted.indexOf(option) === 0
        || option.indexOf(wanted) === 0;
}

function pickLocaleValue(options, locale) {
    var i;
    if (!options || !options.length) return null;
    for (i = 0; i < options.length; i++) {
        if (localeMatches(locale, options[i].locale)) return options[i];
    }
    return options[0];
}

function pickDefaultLocale(locales) {
    var i;
    if (!locales || !locales.length) return '';
    for (i = 0; i < locales.length; i++) {
        if (String(locales[i].locale || '').toLowerCase().indexOf('en') === 0) {
            return locales[i].locale;
        }
    }
    return locales[0].locale;
}

function collectAvailableLocales(fields) {
    var seen = {};
    var list = [];
    var i;
    var j;
    var field;
    var opt;

    for (i = 0; i < (fields || []).length; i++) {
        field = fields[i];
        if (!field || field.type !== 'localized' || !field.options) continue;
        for (j = 0; j < field.options.length; j++) {
            opt = field.options[j];
            if (!opt || !opt.locale || seen[opt.locale]) continue;
            seen[opt.locale] = true;
            list.push({
                locale: opt.locale,
                label: opt.label || formatLocaleLabel(opt.locale)
            });
        }
    }

    list.sort(function (a, b) {
        return String(a.label).localeCompare(String(b.label));
    });
    return list;
}

function applyLocaleToGroupedFields(fields, locale) {
    var output = [];
    var i;
    var field;
    var picked;

    for (i = 0; i < (fields || []).length; i++) {
        field = fields[i];
        if (!field) continue;
        if (field.type === 'localized' && field.options && field.options.length) {
            picked = pickLocaleValue(field.options, locale);
            if (picked) {
                output.push({
                    name: field.name,
                    type: picked.type || 'text',
                    value: picked.value
                });
            }
            continue;
        }
        output.push(field);
    }
    return output;
}

function prepareFieldsForGallery(fields, locale) {
    return prepareFieldsForView(applyLocaleToGroupedFields(fields, locale));
}

function isSimpleGalleryWidget(widgetType) {
    return widgetType === WIDGET_TYPES.mainBanner
        || widgetType === WIDGET_TYPES.campaignBanner
        || widgetType === WIDGET_TYPES.imageAndText;
}

function mergeLocaleValuesFromAmplienceField(map, value) {
    var i;
    if (!value || !Array.isArray(value.values)) return;
    for (i = 0; i < value.values.length; i++) {
        var entry = value.values[i];
        if (!entry || !entry.locale || map[entry.locale]) continue;
        map[entry.locale] = formatLocaleLabel(entry.locale);
    }
}

function collectRichTextLocales(model) {
    var root = getSourceRoot(model.source || {});
    var map = {};
    mergeLocaleValuesFromAmplienceField(map, root.header);
    mergeLocaleValuesFromAmplienceField(map, root.content);
    mergeLocaleValuesFromAmplienceField(map, root.body);
    mergeLocaleValuesFromAmplienceField(map, root.richText);
    mergeLocaleValuesFromAmplienceField(map, root.text);
    return Object.keys(map).sort().map(function (locale) {
        return { locale: locale, label: map[locale] };
    });
}

function getLiveContentRoot(model) {
    var source = model && model.source ? model.source : {};
    if (source.item && source.item.content) return source.item.content;
    return getSourceRoot(source);
}

function applyRichTextLocaleToModel(model, locale) {
    var core = require('./amplienceCore/transform');
    var root = getLiveContentRoot(model);
    var parts = core.extractPreviewPartsForLocale(root, locale);

    model.heading = parts.title ? core.wrapMarkup(parts.title) : '';
    model.bodyHtml = parts.body ? core.wrapMarkup(parts.body) : '';
    model.hasBody = isMeaningfulMarkup(model.bodyHtml);
    model.fields = [];
    if (parts.title) model.name = parts.title;
    if (parts.images && parts.images.length && parts.images[0].url) {
        model.imageUrl = parts.images[0].url;
    }
}

function renderMainBannerHtml(model) {
    var html = '<section class="amp-main-banner">';
    if (model.imageUrl) {
        html += '<img src="' + escapeHtml(model.imageUrl) + '" alt="'
            + escapeHtml(model.name || '') + '" loading="lazy" />';
    }
    html += '<div class="amp-main-banner__overlay">';
    if (model.heading) {
        html += model.heading;
    } else if (model.hasBody && model.bodyHtml) {
        html += model.bodyHtml;
    } else {
        html += '<h2>' + escapeHtml(model.name || '') + '</h2>';
    }
    html += '</div></section>';
    return html;
}

function renderImageTextHtml(model) {
    var html = '<section class="amp-image-text">';
    if (model.imageUrl) {
        html += '<div class="amp-image-text__media"><img src="'
            + escapeHtml(model.imageUrl) + '" alt="' + escapeHtml(model.name || '')
            + '" loading="lazy" /></div>';
    }
    html += '<div class="amp-image-text__copy">';
    if (model.heading) {
        html += model.heading;
    } else {
        html += '<h2>' + escapeHtml(model.name || '') + '</h2>';
    }
    if (model.hasBody && model.bodyHtml) {
        html += model.bodyHtml;
    }
    html += '</div></section>';
    return html;
}

function renderRichTextHtml(model) {
    var html = '<article class="amp-rich-text">';
    if (model.heading) {
        html += '<div class="amp-rich-text__header">' + model.heading + '</div>';
    }
    if (model.hasBody && model.bodyHtml) {
        html += '<div class="amp-rich-text__body">' + model.bodyHtml + '</div>';
    } else if (!model.heading) {
        html += '<h2>' + escapeHtml(model.name || 'Content') + '</h2>';
    }
    html += '</article>';
    return html;
}

function renderGalleryPreviewBody(model) {
    if (!model) return '';

    if (model.widgetType === WIDGET_TYPES.mainBanner
        || model.widgetType === WIDGET_TYPES.campaignBanner) {
        return renderMainBannerHtml(model);
    }
    if (model.widgetType === WIDGET_TYPES.imageAndText) {
        return renderImageTextHtml(model);
    }
    if (model.widgetType === WIDGET_TYPES.editorialRichText) {
        return renderRichTextHtml(model);
    }

    var parts = [];
    var i;
    var field;

    if (model.hasBody && model.bodyHtml) {
        parts.push(String(model.bodyHtml));
    }
    if (model.images && model.images.length) {
        for (i = 0; i < model.images.length; i++) {
            if (model.images[i] && model.images[i].url) {
                parts.push('<figure class="amp-widget-fallback__image"><img src="'
                    + escapeHtml(model.images[i].url) + '" alt="'
                    + escapeHtml(model.images[i].name || '') + '" loading="lazy" /></figure>');
            }
        }
    }
    for (i = 0; i < (model.fields || []).length; i++) {
        field = model.fields[i];
        if (field && field.markup) parts.push(field.markup);
    }
    if (!parts.length) {
        parts.push('<h2>' + escapeHtml(model.name || 'Content') + '</h2>');
    }
    return '<section class="amp-widget-fallback">' + parts.join('') + '</section>';
}

function enrichGalleryModel(model, asset) {
    if (!model) return model;

    if (isSimpleGalleryWidget(model.widgetType)) {
        model.availableLocales = [];
        model.previewLocale = '';
        model.fields = [];
        return model;
    }

    if (model.widgetType === WIDGET_TYPES.editorialRichText) {
        var richLocales = collectRichTextLocales(model);
        model.availableLocales = richLocales;
        model.previewLocale = pickDefaultLocale(richLocales);
        applyRichTextLocaleToModel(model, model.previewLocale);
        return model;
    }

    var grouped = getGroupedFieldsRaw(model.attributes || {}, model.source || {});
    var locales = collectAvailableLocales(grouped);
    model.availableLocales = locales;
    model.previewLocale = pickDefaultLocale(locales);
    model.fields = locales.length > 1
        ? prepareFieldsForGallery(grouped, model.previewLocale)
        : prepareFieldsForView(grouped);
    return model;
}

/**
 * Live Amplience preview HTML for one gallery card + locale (CDN cached server-side).
 * @param {string} contentId - SFCC content ID
 * @param {string} locale - Requested locale
 * @returns {Object} Preview payload
 */
function getGalleryPreviewForLocale(contentId, locale) {
    if (!contentId) {
        return { ok: false, error: 'Content id is required' };
    }

    var asset = ContentMgr.getContent(String(contentId));
    var model = resolveFromContentAsset(asset);
    if (!model) {
        return { ok: false, error: 'Content asset not found' };
    }

    if (isLiveContentEnabled()) {
        model = resolveLiveContent(model, asset, { bypassCache: false });
    }

    if (isSimpleGalleryWidget(model.widgetType)) {
        return {
            ok: true,
            html: renderGalleryPreviewBody(model),
            locales: [],
            locale: '',
            live: !!model.live,
            liveError: model.liveError || ''
        };
    }

    if (model.widgetType === WIDGET_TYPES.editorialRichText) {
        var richLocales = collectRichTextLocales(model);
        var activeRichLocale = locale || pickDefaultLocale(richLocales);
        applyRichTextLocaleToModel(model, activeRichLocale);
        return {
            ok: true,
            html: renderGalleryPreviewBody(model),
            locales: richLocales,
            locale: activeRichLocale,
            live: !!model.live,
            liveError: model.liveError || ''
        };
    }

    var grouped = groupLocalizedPreviewFields(extractSourceFields(model.source || {}));
    if (!grouped.length) {
        grouped = getGroupedFieldsRaw(model.attributes || {}, model.source || {});
    }

    var locales = collectAvailableLocales(grouped);
    var activeLocale = locale || pickDefaultLocale(locales);
    model.fields = prepareFieldsForGallery(grouped, activeLocale);

    return {
        ok: true,
        html: renderGalleryPreviewBody(model),
        locales: locales,
        locale: activeLocale,
        live: !!model.live,
        liveError: model.liveError || ''
    };
}

/**
 * Select normalized preview images.
 * @param {Object} attributes - Migrated widget attributes
 * @param {string} imageUrl - Primary image fallback
 * @returns {Array} Preview images
 */
function normalizeImages(attributes, imageUrl) {
    if (attributes && attributes.previewImages && attributes.previewImages.length) {
        return attributes.previewImages;
    }
    if (attributes && attributes.images && attributes.images.length) {
        return attributes.images;
    }
    return imageUrl ? [{ name: 'image', url: imageUrl }] : [];
}

function resolveDisplayName(asset, attributes, source) {
    var root = getSourceRoot(source);
    var metaName = (root._meta && root._meta.name) || '';
    var fieldTitle = '';
    var fields = (attributes && attributes.previewFields) || [];
    var i;

    for (i = 0; i < fields.length; i++) {
        if (fields[i] && /^(title|headline|heading|name)$/i.test(fields[i].name) && fields[i].value) {
            fieldTitle = String(fields[i].value);
            break;
        }
    }

    var candidates = [metaName, fieldTitle, asset.name, asset.ID];
    for (i = 0; i < candidates.length; i++) {
        var candidate = String(candidates[i] || '').trim();
        if (!candidate) continue;
        if (/^amp-[a-f0-9-]{8,}$/i.test(candidate)) continue;
        return candidate;
    }

    return asset.name || asset.ID;
}

function resolveWidgetLabel(widgetType, schema) {
    var labels = {
        mainBanner: 'Main Banner',
        campaignBanner: 'Campaign Banner',
        editorialRichText: 'Editorial Rich Text',
        imageAndText: 'Image and Text',
        amplienceWidget: 'Amplience Widget'
    };
    var schemaUri = String(schema || '');
    var parts;
    var shortName;

    if (schemaUri) {
        parts = schemaUri.split('/');
        shortName = parts[parts.length - 1] || '';
        if (shortName && shortName.indexOf('#') < 0) {
            return shortName.replace(/[-_]/g, ' ');
        }
    }
    return labels[widgetType] || widgetType;
}

/**
 * Filter options for the storefront component gallery.
 * @returns {Array} Widget type filter chips
 */
function getWidgetTypeFilters() {
    return [
        { id: '', label: 'All components' },
        { id: WIDGET_TYPES.mainBanner, label: 'Main banners' },
        { id: WIDGET_TYPES.campaignBanner, label: 'Campaign banners' },
        { id: WIDGET_TYPES.imageAndText, label: 'Image and text' },
        { id: WIDGET_TYPES.editorialRichText, label: 'Editorial rich text' },
        { id: WIDGET_TYPES.amplienceWidget, label: 'Generic widgets' }
    ];
}

/**
 * Whether a migrated model matches a storefront search query.
 * @param {Object} model - Renderer model
 * @param {string} query - Search text
 * @returns {boolean} True when the model matches
 */
function matchesQuery(model, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return true;

    var haystack = [
        model.name,
        model.id,
        model.contentId,
        model.deliveryKey,
        model.widgetType,
        model.widgetLabel,
        model.description
    ].map(function (value) {
        return String(value || '').toLowerCase();
    }).join(' ');

    return haystack.indexOf(q) >= 0;
}

/**
 * Build the renderer view model for one SFCC content asset.
 * @param {dw.content.Content} asset - SFCC content asset
 * @returns {Object|null} Renderer model
 */
function resolveFromContentAsset(asset) {
    if (!asset || !asset.online || !asset.custom) return null;

    var custom = asset.custom;
    var attributes = parseJsonSafe(custom.amplienceWidgetAttributes, {}) || {};
    var source = parseJsonSafe(custom.amplienceSourceJson, {}) || {};
    var widgetType = String(custom.amplienceWidgetType || WIDGET_TYPES.amplienceWidget);
    var fields = normalizeFields(attributes, source);
    var imageUrl = String(
        getImageUrl(custom.amplienceImageUrl)
        || getImageUrl(attributes.image)
        || (attributes.previewImages && attributes.previewImages[0]
            && getImageUrl(attributes.previewImages[0].url))
        || (fields.filter(function (field) {
            return field.type === 'image';
        })[0] || {}).value
        || ''
    );
    var bodyHtml = String(
        custom.body
        || attributes.richText
        || attributes.bannerMessage
        || attributes.previewHtml
        || attributes.text
        || ''
    );

    return {
        id: asset.ID,
        name: resolveDisplayName(asset, attributes, source),
        description: asset.description || '',
        widgetType: widgetType,
        widgetLabel: resolveWidgetLabel(widgetType, String(custom.amplienceSchema || '')),
        schema: String(custom.amplienceSchema || ''),
        deliveryKey: String(custom.amplienceDeliveryKey || ''),
        contentId: String(custom.amplienceContentId || ''),
        imageUrl: imageUrl,
        heading: String(attributes.heading || ''),
        bodyHtml: bodyHtml,
        hasBody: isMeaningfulMarkup(bodyHtml),
        attributes: attributes,
        fields: fields,
        images: normalizeImages(attributes, imageUrl),
        source: source
    };
}

/**
 * Whether live Amplience CDN refresh is enabled for this site.
 * @returns {boolean} True when live fetch is allowed
 */
function isLiveContentEnabled() {
    try {
        var site = Site.getCurrent();
        if (!site) return true;
        var pref = site.getCustomPreferenceValue('amplienceLiveContent');
        if (pref === false || pref === 'false' || pref === 0) return false;
    } catch (e) {
        // Preference may not exist yet — live is on by default.
    }
    return true;
}

/**
 * Resolve the Amplience hub name for CDN calls.
 * @param {Object} custom - SFCC content custom attributes
 * @param {Object} attributes - Parsed widget attributes
 * @returns {string} Hub name
 */
function getHubName(custom, attributes) {
    try {
        var site = Site.getCurrent();
        var pref = site && site.getCustomPreferenceValue('amplienceHubName');
        if (pref) return String(pref).trim();
    } catch (e) {
        // Preference may not exist yet.
    }

    if (attributes && attributes.hubName) return String(attributes.hubName).trim();
    if (custom && custom.amplienceWidgetAttributes) {
        var attrs = parseJsonSafe(custom.amplienceWidgetAttributes, {}) || {};
        if (attrs.hubName) return String(attrs.hubName).trim();
    }

    try {
        var cfg;
        try {
            cfg = require('*/cartridge/scripts/helpers/amplienceConfig');
        } catch (eCfg) {
            cfg = require('*/cartridge/scripts/helpers/amplienceConfig.defaults');
        }
        if (cfg && cfg.hubName) return String(cfg.hubName).trim();
    } catch (e2) {
        // optional
    }
    return '';
}

/**
 * Refresh a migrated model from Amplience CDN when possible.
 * Uses at most one HTTPClient call (cached thereafter).
 * @param {Object} model - Migrated renderer model
 * @param {dw.content.Content} asset - SFCC content asset
 * @returns {Object} Live or fallback model
 */
function resolveLiveContent(model, asset, options) {
    if (!model || !asset || !isLiveContentEnabled()) return model;
    if (!model.deliveryKey && !model.contentId) return model;

    var hubName = getHubName(asset.custom, model.attributes);
    if (!hubName) {
        model.liveError = 'Amplience hub is not configured (amplienceHubName / amplienceConfig.hubName).';
        return model;
    }

    var opts = options || {};
    try {
        var liveFetcher = require('*/cartridge/scripts/helpers/amplienceLiveFetcher');
        var liveTransform = require('*/cartridge/scripts/helpers/amplienceLiveTransform');
        var live = liveFetcher.fetchLive(hubName, model.deliveryKey, model.contentId, {
            bypassCache: !!opts.bypassCache
        });
        if (!live.ok || !live.content) {
            model.liveError = live.error || 'Live CDN refresh failed';
            model.liveHubName = hubName;
            return model;
        }

        return liveTransform.applyLiveContent(
            model,
            live.content,
            hubName,
            extractSourceFields,
            isMeaningfulMarkup,
            groupLocalizedPreviewFields,
            prepareFieldsForView
        );
    } catch (e) {
        model.liveError = String(e.message || e);
        model.liveHubName = hubName;
        return model;
    }
}

/**
 * Load one migrated asset by SFCC content ID.
 * Live CDN is the default when enabled (no IMPEX re-import required).
 * @param {string} contentId - SFCC content ID
 * @param {Object} [options] - Query options
 * @param {boolean} [options.live] - Override live fetch (default true when live enabled)
 * @param {boolean} [options.bypassCache] - Skip short CDN cache for immediate publish checks
 * @returns {Object|null} Renderer model
 */
function getAmplienceAsset(contentId, options) {
    if (!contentId) return null;
    var asset = ContentMgr.getContent(String(contentId));
    var model = resolveFromContentAsset(asset);
    if (!model) return null;

    var opts = options || {};
    var live = opts.live !== false;
    if (live) {
        return resolveLiveContent(model, asset, opts);
    }
    return model;
}

/**
 * Load multiple migrated assets in display order for a composed page.
 * @param {string} csvIds - Comma-separated SFCC content IDs
 * @param {Object} [options] - getAmplienceAsset options
 * @returns {Array} Renderer models
 */
function getAmplienceComposePage(csvIds, options) {
    var ids = String(csvIds || '').split(',');
    var models = [];
    var i;
    var id;
    var model;

    for (i = 0; i < ids.length; i++) {
        id = String(ids[i] || '').trim();
        if (!id) continue;
        model = getAmplienceAsset(id, options);
        if (model) models.push(model);
    }

    return models;
}

/**
 * Convert an SFCC collection or JavaScript array to an array.
 * @param {dw.util.Collection|Array} collection - Content collection
 * @returns {Array} Array values
 */
function collectionToArray(collection) {
    var result = [];
    var iterator;
    var i;

    if (!collection) return result;
    if (collection.iterator) {
        iterator = collection.iterator();
        while (iterator.hasNext()) result.push(iterator.next());
        return result;
    }
    if (typeof collection.length === 'number') {
        for (i = 0; i < collection.length; i++) result.push(collection[i]);
    }
    return result;
}

/**
 * Load online content from the migrated Amplience folder.
 * @param {string} folderId - SFCC content folder ID
 * @returns {Array} Online content assets
 */
function getFolderContent(folderId) {
    var folder = ContentMgr.getFolder(folderId || FOLDER_ID);
    if (!folder || folder.online === false) return [];

    var content = typeof folder.getOnlineContent === 'function'
        ? folder.getOnlineContent()
        : folder.onlineContent;

    return collectionToArray(content);
}

/**
 * Load, filter, sort, and paginate migrated content.
 * @param {Object} options - Query options
 * @returns {Object} Paged renderer models
 */
function getAmplienceAssets(options) {
    var opts = options || {};
    var pageSize = Math.max(1, Math.min(parseInt(opts.pageSize, 10) || 12, 48));
    var page = Math.max(1, parseInt(opts.page, 10) || 1);
    var type = String(opts.type || '');
    var query = String(opts.query || '').trim();
    var models = [];

    getFolderContent(opts.folderId).forEach(function (asset) {
        var model = resolveFromContentAsset(asset);
        // Never live-fetch in list mode — SFCC allows only ~16 HTTPClient calls per request.
        if (model && (!type || model.widgetType === type) && matchesQuery(model, query)) {
            models.push(enrichGalleryModel(model, asset));
        }
    });

    models.sort(function (a, b) {
        return String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
    });

    var total = models.length;
    var pageCount = Math.max(1, Math.ceil(total / pageSize));
    page = Math.min(page, pageCount);
    var start = (page - 1) * pageSize;

    return {
        items: models.slice(start, start + pageSize),
        total: total,
        page: page,
        pageSize: pageSize,
        pageCount: pageCount,
        hasPrevious: page > 1,
        hasNext: page < pageCount,
        type: type,
        query: query,
        folderFound: !!ContentMgr.getFolder(opts.folderId || FOLDER_ID)
    };
}

/**
 * Convert an Amplience delivery key to its exported SFCC content ID.
 * @param {string} deliveryKey - Amplience delivery key
 * @returns {string} SFCC content ID
 */
function sanitizeDeliveryKeyToContentId(deliveryKey) {
    var raw = String(deliveryKey || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!raw) return '';
    if (raw.length > 100) raw = raw.substring(0, 100);
    return 'amp-' + raw;
}

/**
 * Pre-warm CDN cache for gallery items in the current request (one SFCC hit).
 * @param {Array} models - Renderer models for the current gallery page
 * @returns {void}
 */
function warmLiveCacheForModels(models) {
    if (!isLiveContentEnabled() || !models || !models.length) return;

    var liveFetcher = require('*/cartridge/scripts/helpers/amplienceLiveFetcher');
    var i;
    var model;
    var hubName;

    for (i = 0; i < models.length; i++) {
        model = models[i];
        if (!model || (!model.deliveryKey && !model.contentId)) continue;
        hubName = getHubName(null, model.attributes || {});
        if (!hubName) continue;
        liveFetcher.fetchLive(hubName, model.deliveryKey, model.contentId, {
            bypassCache: false
        });
    }
}

module.exports = {
    FOLDER_ID: FOLDER_ID,
    WIDGET_TYPES: WIDGET_TYPES,
    getWidgetTypeFilters: getWidgetTypeFilters,
    matchesQuery: matchesQuery,
    parseJsonSafe: parseJsonSafe,
    extractSourceFields: extractSourceFields,
    groupLocalizedPreviewFields: groupLocalizedPreviewFields,
    prepareFieldsForView: prepareFieldsForView,
    resolveFromContentAsset: resolveFromContentAsset,
    resolveLiveContent: resolveLiveContent,
    isLiveContentEnabled: isLiveContentEnabled,
    getHubName: getHubName,
    getAmplienceAsset: getAmplienceAsset,
    getAmplienceComposePage: getAmplienceComposePage,
    getAmplienceAssets: getAmplienceAssets,
    enrichGalleryModel: enrichGalleryModel,
    getGalleryPreviewForLocale: getGalleryPreviewForLocale,
    warmLiveCacheForModels: warmLiveCacheForModels,
    sanitizeDeliveryKeyToContentId: sanitizeDeliveryKeyToContentId
};
