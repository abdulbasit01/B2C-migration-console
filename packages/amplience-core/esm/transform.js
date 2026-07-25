var WIDGET_TYPES = {
    campaignBanner: 'campaignBanner',
    editorialRichText: 'editorialRichText',
    mainBanner: 'mainBanner',
    imageAndText: 'imageAndText',
    amplienceWidget: 'amplienceWidget'
};

var WIDGET_TYPE_FILTERS = [
    { id: '', label: 'All components' },
    { id: WIDGET_TYPES.mainBanner, label: 'Main banners' },
    { id: WIDGET_TYPES.campaignBanner, label: 'Campaign banners' },
    { id: WIDGET_TYPES.imageAndText, label: 'Image and text' },
    { id: WIDGET_TYPES.editorialRichText, label: 'Editorial rich text' },
    { id: WIDGET_TYPES.amplienceWidget, label: 'Generic widgets' }
];

function getMeta(content) {
    return (content && content._meta) ? content._meta : {};
}

function getSchemaUri(content) {
    var meta = getMeta(content);
    return String(meta.schema || meta.name || '').trim();
}

function schemaShortName(schemaUri) {
    var s = String(schemaUri || '');
    if (!s) return '';
    var parts = s.split('/');
    return parts[parts.length - 1] || s;
}

function firstString(obj, keys) {
    if (!obj) return '';
    var i;
    for (i = 0; i < keys.length; i++) {
        var val = obj[keys[i]];
        if (typeof val === 'string' && val.trim()) {
            return val.trim();
        }
    }
    return '';
}

function buildImageUrl(imageObj) {
    if (!imageObj) return '';
    if (typeof imageObj === 'string') {
        if (imageObj.indexOf('http') !== 0 && imageObj.indexOf('//') !== 0) return '';
        if (/\.html?(?:\?|#|$)/i.test(imageObj) || /\/guide\//i.test(imageObj)) return '';
        return imageObj;
    }
    if (imageObj.di) return String(imageObj.di);
    if (imageObj.url) return buildImageUrl(String(imageObj.url));
    if (imageObj.src) return buildImageUrl(String(imageObj.src));
    if (imageObj.defaultHost && imageObj.endpoint && imageObj.name) {
        return 'https://' + imageObj.defaultHost + '/i/' + imageObj.endpoint + '/' + imageObj.name;
    }
    return '';
}

function wrapMarkup(text) {
    var value = String(text || '').trim();
    if (!value) return '';
    if (value.indexOf('<') >= 0) return value;
    if (value.indexOf('#') >= 0 || value.indexOf('**') >= 0 || value.indexOf('[') >= 0) {
        return markdownToHtml(value);
    }
    return '<p>' + value + '</p>';
}

function markdownToHtml(markdown) {
    var text = String(markdown || '').trim();
    if (!text) return '';
    if (text.indexOf('<') >= 0) return text;

    var html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    return html.split(/\n\n+/).map(function (paragraph) {
        var trimmed = paragraph.trim();
        if (!trimmed) return '';
        if (/^<h[1-6]>/.test(trimmed)) return trimmed;
        return '<p>' + trimmed.replace(/\n/g, '<br>') + '</p>';
    }).join('');
}

function isPlainObject(val) {
    return val && typeof val === 'object' && !Array.isArray(val);
}

function looksLikeImage(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return !!(obj.defaultHost || obj.endpoint || obj.di || obj.id
        || ((obj.url || obj.src) && !obj.values && !obj.image));
}

function collectImage(name, value, images, fields) {
    var candidate = value;
    if (isPlainObject(value) && value.image) candidate = value.image;
    if (isPlainObject(value) && value.backgroundImage) candidate = value.backgroundImage;
    var imgUrl = buildImageUrl(candidate);
    if (!imgUrl && looksLikeImage(value)) imgUrl = buildImageUrl(value);
    if (!imgUrl) return;
    images.push({ name: name, url: imgUrl, id: (candidate && candidate.id) || '' });
    fields.push({ name: name, type: 'image', value: imgUrl });
}

function localizedString(value) {
    if (typeof value === 'string') return value.trim();
    if (!isPlainObject(value) || !Array.isArray(value.values)) return '';
    var preferred = '';
    var i;
    for (i = 0; i < value.values.length; i++) {
        var entry = value.values[i];
        if (!entry || typeof entry.value !== 'string' || !entry.value.trim()) continue;
        if (!preferred) preferred = entry.value.trim();
        if (String(entry.locale || '').toLowerCase().indexOf('en') === 0) {
            return entry.value.trim();
        }
    }
    return preferred;
}

function localizedObject(value) {
    if (!isPlainObject(value) || !Array.isArray(value.values)) return null;
    var preferred = null;
    var i;
    for (i = 0; i < value.values.length; i++) {
        var entry = value.values[i];
        if (!entry || entry.value == null) continue;
        if (!preferred) preferred = entry.value;
        if (String(entry.locale || '').toLowerCase().indexOf('en') === 0) {
            return entry.value;
        }
    }
    return preferred;
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

function pickLocalizedEntry(values, locale) {
    var i;
    var fallback = null;
    if (!Array.isArray(values) || !values.length) return null;
    for (i = 0; i < values.length; i++) {
        var entry = values[i];
        if (!entry || entry.value == null) continue;
        if (!fallback) fallback = entry;
        if (localeMatches(locale, entry.locale || entry.lang)) return entry;
    }
    return fallback;
}

function localizedStringForLocale(value, locale) {
    if (typeof value === 'string') return value.trim();
    if (!isPlainObject(value) || !Array.isArray(value.values)) return '';
    var entry = pickLocalizedEntry(value.values, locale);
    if (!entry) return '';
    if (typeof entry.value === 'string') return entry.value.trim();
    return '';
}

function localizedObjectForLocale(value, locale) {
    if (!isPlainObject(value) || !Array.isArray(value.values)) return null;
    var entry = pickLocalizedEntry(value.values, locale);
    return entry ? entry.value : null;
}

function blocksToText(blocks) {
    if (!blocks) return '';
    if (typeof blocks === 'string') return blocks.trim();
    if (!Array.isArray(blocks)) return '';
    var parts = [];
    var i;
    for (i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if (!block) continue;
        if (typeof block === 'string') parts.push(block);
        else if (block.data) parts.push(String(block.data));
        else if (block.text) parts.push(String(block.text));
    }
    return parts.join('\n\n').trim();
}

function extractRichTextContent(value) {
    var localized = localizedObject(value);
    if (localized) {
        if (localized.richText) return blocksToText(localized.richText);
        if (typeof localized === 'string') return localized.trim();
    }
    if (isPlainObject(value) && value.richText) return blocksToText(value.richText);
    return localizedString(value) || '';
}

function extractRichTextContentForLocale(value, locale) {
    var localized = localizedObjectForLocale(value, locale);
    if (localized) {
        if (localized.richText) return blocksToText(localized.richText);
        if (typeof localized === 'string') return localized.trim();
    }
    if (isPlainObject(value) && value.richText) return blocksToText(value.richText);
    return localizedStringForLocale(value, locale) || '';
}

function isSfccAmplienceWrapper(content) {
    var schema = String(getSchemaUri(content) || '').toLowerCase();
    return !!(content && content.header)
        || schema.indexOf('rich-text') >= 0
        || schema.indexOf('/rich') >= 0
        || schema.indexOf('banner') >= 0
        || schema.indexOf('hero') >= 0;
}

function isMeaningfulMarkup(value) {
    return String(value || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, '')
        .replace(/\s/g, '')
        .length > 0;
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
 * e.g. seo.title.values[en-us] + seo.title.values[fr-fr] → type localized + options[].
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

/**
 * Extract preview parts from live Amplience content.
 * @param {Object} content - Live CDN content body
 * @returns {{ fields: Array, images: Array, title: string, body: string, textAlign: string, root: Object }}
 */
function extractPreviewParts(content) {
    var fields = [];
    var images = [];
    var title = '';
    var body = '';
    var textAlign = '';
    var skip = { _meta: 1, _links: 1 };

    if (!content || typeof content !== 'object') {
        return {
            fields: fields,
            images: images,
            title: title,
            body: body,
            textAlign: textAlign,
            root: {}
        };
    }

    var root = content;
    if (isPlainObject(content.content) && content.content._meta && !isSfccAmplienceWrapper(content)) {
        root = content.content;
    }

    if (root.img) collectImage('img', root.img, images, fields);
    if (root.image) collectImage('image', root.image, images, fields);
    if (root.backgroundImage) collectImage('backgroundImage', root.backgroundImage, images, fields);
    if (root.bannerImage) collectImage('bannerImage', root.bannerImage, images, fields);
    if (root.heroImage) collectImage('heroImage', root.heroImage, images, fields);

    // Entire item may be a core localized-value schema (values[] at root).
    if (Array.isArray(root.values) && root.values.length) {
        var rootLocalized = localizedString(root);
        if (rootLocalized) {
            title = rootLocalized;
            fields.push({ name: 'value', type: 'text', value: rootLocalized });
        }
    }

    title = title
        || localizedString(root.header)
        || localizedString(root.title)
        || localizedString(root.headline)
        || localizedString(root.heading)
        || firstString(root, ['title', 'headline', 'heading', 'bannerMessage', 'message', 'name'])
        || getMeta(root).name
        || '';
    body = localizedString(root.body)
        || localizedString(root.text)
        || localizedString(root.copy)
        || localizedString(root.richText)
        || localizedString(root.html)
        || localizedString(root.content)
        || firstString(root, ['body', 'text', 'copy', 'description', 'richText', 'html', 'content']);
    if (!body && root.content) {
        body = extractRichTextContent(root.content);
    }
    textAlign = String(root.textAlign || root.justifyContent || '').trim();

    if (title) fields.push({ name: 'title', type: 'text', value: title });
    if (body) fields.push({ name: 'body', type: 'text', value: body });

    if (!images.length) {
        var keys = Object.keys(root);
        var i;
        for (i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (skip[key]) continue;
            collectImage(key, root[key], images, fields);
        }
    }

    return {
        fields: fields,
        images: images,
        title: title,
        body: body,
        textAlign: textAlign,
        root: root
    };
}

/**
 * Extract preview parts for a specific locale (header, rich-text blocks, images).
 * @param {Object} content - Live CDN content body
 * @param {string} [locale] - Requested locale code
 * @returns {{ fields: Array, images: Array, title: string, body: string, textAlign: string, root: Object }}
 */
function extractPreviewPartsForLocale(content, locale) {
    var fields = [];
    var images = [];
    var title = '';
    var body = '';
    var textAlign = '';
    var skip = { _meta: 1, _links: 1 };

    if (!content || typeof content !== 'object') {
        return {
            fields: fields,
            images: images,
            title: title,
            body: body,
            textAlign: textAlign,
            root: {}
        };
    }

    var root = content;
    if (isPlainObject(content.content) && content.content._meta && !isSfccAmplienceWrapper(content)) {
        root = content.content;
    }

    if (root.img) collectImage('img', root.img, images, fields);
    if (root.image) collectImage('image', root.image, images, fields);
    if (root.backgroundImage) collectImage('backgroundImage', root.backgroundImage, images, fields);
    if (root.bannerImage) collectImage('bannerImage', root.bannerImage, images, fields);
    if (root.heroImage) collectImage('heroImage', root.heroImage, images, fields);

    if (Array.isArray(root.values) && root.values.length) {
        var rootLocalized = localizedStringForLocale(root, locale);
        if (rootLocalized) {
            title = rootLocalized;
            fields.push({ name: 'value', type: 'text', value: rootLocalized });
        }
    }

    title = title
        || localizedStringForLocale(root.header, locale)
        || localizedStringForLocale(root.title, locale)
        || localizedStringForLocale(root.headline, locale)
        || localizedStringForLocale(root.heading, locale)
        || firstString(root, ['title', 'headline', 'heading', 'bannerMessage', 'message', 'name'])
        || getMeta(root).name
        || '';
    body = localizedStringForLocale(root.body, locale)
        || localizedStringForLocale(root.text, locale)
        || localizedStringForLocale(root.copy, locale)
        || localizedStringForLocale(root.richText, locale)
        || localizedStringForLocale(root.html, locale)
        || firstString(root, ['body', 'text', 'copy', 'description', 'richText', 'html', 'content']);
    if (!body && root.content) {
        body = extractRichTextContentForLocale(root.content, locale);
    }
    if (!body && root.richText) {
        body = extractRichTextContentForLocale(root.richText, locale);
    }
    textAlign = String(root.textAlign || root.justifyContent || '').trim();

    if (title) fields.push({ name: 'title', type: 'text', value: title });
    if (body) fields.push({ name: 'body', type: 'text', value: body });

    if (!images.length) {
        var keys = Object.keys(root);
        var i;
        for (i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (skip[key]) continue;
            collectImage(key, root[key], images, fields);
        }
    }

    return {
        fields: fields,
        images: images,
        title: title,
        body: body,
        textAlign: textAlign,
        root: root
    };
}

/**
 * Detect widget type from live Amplience content.
 * @param {Object} content - Live CDN content body
 * @returns {string} Widget type id
 */
function detectWidgetType(content) {
    var parts = extractPreviewParts(content);
    var schema = String(getSchemaUri(content) || getSchemaUri(parts.root) || '').toLowerCase();
    var head = parts.title;
    var body = parts.body;
    var image = parts.images.length ? parts.images[0].url : '';

    if (schema.indexOf('banner') >= 0 || schema.indexOf('hero') >= 0) {
        return image ? WIDGET_TYPES.mainBanner : WIDGET_TYPES.campaignBanner;
    }
    if (schema.indexOf('hotspot') >= 0) {
        return WIDGET_TYPES.amplienceWidget;
    }
    if (schema.indexOf('rich') >= 0 || schema.indexOf('article') >= 0 || schema.indexOf('editorial') >= 0
        || schema.indexOf('/text') >= 0 || schema.indexOf('paragraph') >= 0 || schema.indexOf('rich-text') >= 0) {
        return WIDGET_TYPES.editorialRichText;
    }
    if (image && (head || body)) {
        return WIDGET_TYPES.imageAndText;
    }
    if (head && !body && !parts.fields.length) {
        return WIDGET_TYPES.campaignBanner;
    }
    if (body && parts.fields.length <= 3) {
        return WIDGET_TYPES.editorialRichText;
    }
    return WIDGET_TYPES.amplienceWidget;
}

/**
 * Transform Amplience content into an SFCC Page Designer widget mapping.
 * @param {Object} content - Live CDN content body
 * @param {string} deliveryKey - Delivery key
 * @param {string} hubName - Hub name
 * @param {string} contentId - Content UUID
 * @returns {Object} Widget mapping
 */
function mapToWidget(content, deliveryKey, hubName, contentId) {
    var parts = extractPreviewParts(content);
    var root = parts.root || content || {};
    var widgetType = detectWidgetType(content);
    var head = parts.title;
    var body = parts.body;
    var imageUrl = parts.images.length ? parts.images[0].url : '';
    var meta = getMeta(root);
    var schemaUri = getSchemaUri(root) || meta.schema || '';
    var realKey = deliveryKey || meta.deliveryKey || '';
    var attributes = {};

    if (widgetType === WIDGET_TYPES.campaignBanner) {
        attributes = { bannerMessage: wrapMarkup(head || body), hubName: hubName || '' };
    } else if (widgetType === WIDGET_TYPES.editorialRichText) {
        attributes = { richText: wrapMarkup(body || head), hubName: hubName || '' };
    } else if (widgetType === WIDGET_TYPES.mainBanner) {
        attributes = {
            heading: wrapMarkup(head || body) || '<p></p>',
            image: imageUrl,
            hubName: hubName || ''
        };
    } else if (widgetType === WIDGET_TYPES.imageAndText) {
        attributes = {
            heading: wrapMarkup(head) || '<p></p>',
            image: imageUrl,
            text: wrapMarkup(body),
            hubName: hubName || ''
        };
    } else {
        attributes = {
            deliveryKey: realKey,
            contentId: contentId || '',
            hubName: hubName || '',
            schema: schemaUri,
            fields: parts.fields,
            images: parts.images,
            previewHtml: wrapMarkup(body || head || '')
        };
    }

    attributes.previewFields = groupLocalizedPreviewFields(parts.fields);
    attributes.previewImages = parts.images;

    return {
        widgetType: widgetType,
        widgetLabel: schemaShortName(schemaUri) || widgetType,
        deliveryKey: realKey,
        contentId: contentId || '',
        hasDeliveryKey: !!realKey,
        schema: schemaUri,
        schemaShort: schemaShortName(schemaUri),
        attributes: attributes,
        preview: {
            title: head || meta.name || realKey || contentId || 'Amplience content',
            body: body,
            image: imageUrl,
            images: parts.images,
            fields: parts.fields,
            schema: schemaUri
        }
    };
}

/**
 * Transform fetched Amplience payload into a widget mapping.
 * @param {Object} fetched
 * @returns {Object}
 */
function transformFetchedContent(fetched) {
    var content = fetched.content || {};
    var widget = mapToWidget(content, fetched.deliveryKey, fetched.hubName, fetched.contentId);
    widget.source = fetched.rawItem || content;
    widget.sourceMetadata = {
        label: fetched.label || '',
        status: fetched.status || '',
        locale: fetched.locale || '',
        lastModified: fetched.lastModified || '',
        source: fetched.source || ''
    };
    return widget;
}

/**
 * Build a storefront / React renderer model from live Amplience content.
 * @param {Object} content - Live CDN content body
 * @param {Object} [options]
 * @param {string} [options.hubName]
 * @param {string} [options.deliveryKey]
 * @param {string} [options.contentId]
 * @param {string} [options.targetWidget] - Optional override from Page Designer
 * @returns {Object} Renderer model
 */
function toRendererModel(content, options) {
    options = options || {};
    var hubName = options.hubName || '';
    var deliveryKey = options.deliveryKey || '';
    var contentId = options.contentId || '';
    var parts = extractPreviewParts(content);
    var widgetType = options.targetWidget || detectWidgetType(content);
    var widget = mapToWidget(content, deliveryKey, hubName, contentId);
    var imageUrl = parts.images.length ? parts.images[0].url : '';
    var imageId = parts.images.length ? (parts.images[0].id || '') : '';

    if (imageUrl && imageId) {
        imageUrl += (imageUrl.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(imageId);
    }

    var heading = wrapMarkup(parts.title || parts.body);
    var bodyHtml = wrapMarkup(parts.body || parts.title);

    if (widgetType === WIDGET_TYPES.campaignBanner) {
        bodyHtml = wrapMarkup(parts.title || parts.body);
        heading = '';
    } else if (widgetType === WIDGET_TYPES.editorialRichText) {
        heading = wrapMarkup(parts.title);
        bodyHtml = wrapMarkup(parts.body || '');
    } else if (widgetType === WIDGET_TYPES.mainBanner) {
        heading = wrapMarkup(parts.title || parts.body);
    } else if (widgetType === WIDGET_TYPES.imageAndText) {
        heading = wrapMarkup(parts.title);
        bodyHtml = wrapMarkup(parts.body);
    }

    return {
        widgetType: widgetType,
        widgetLabel: widget.widgetLabel,
        name: parts.title || getMeta(content).name || deliveryKey || contentId || 'Amplience content',
        schema: getSchemaUri(content) || widget.schema,
        deliveryKey: deliveryKey || widget.deliveryKey,
        contentId: contentId || widget.contentId,
        imageUrl: imageUrl,
        heading: heading,
        bodyHtml: bodyHtml,
        hasBody: isMeaningfulMarkup(bodyHtml),
        textAlign: parts.textAlign || '',
        fields: groupLocalizedPreviewFields(parts.fields),
        images: parts.images,
        attributes: widget.attributes,
        preview: widget.preview,
        live: true,
        liveSource: 'cdn',
        liveHubName: hubName
    };
}

export { WIDGET_TYPES, WIDGET_TYPE_FILTERS, extractPreviewParts, extractPreviewPartsForLocale, detectWidgetType, mapToWidget, transformFetchedContent, toRendererModel, isMeaningfulMarkup, wrapMarkup, groupLocalizedPreviewFields };
