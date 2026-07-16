'use strict';

var WIDGET_TYPES = {
    campaignBanner: 'campaignBanner',
    editorialRichText: 'editorialRichText',
    mainBanner: 'mainBanner',
    imageAndText: 'imageAndText',
    amplienceWidget: 'amplienceWidget'
};

function getMeta(content) {
    return (content && content._meta) ? content._meta : {};
}

function getSchemaUri(content) {
    var meta = getMeta(content);
    return String(meta.schema || meta.name || '').trim();
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
    return '<p>' + value + '</p>';
}

function isPlainObject(val) {
    return val && typeof val === 'object' && !Array.isArray(val);
}

function looksLikeImage(obj) {
    if (!obj || typeof obj !== 'object') return false;
    // Prefer real Amplience image-link shapes; avoid matching random objects with a "name".
    return !!(obj.defaultHost || obj.endpoint || obj.di || obj.id
        || ((obj.url || obj.src) && !obj.values && !obj.image));
}

/**
 * Collect an image URL from common Amplience field shapes.
 * @param {string} name - Field name
 * @param {*} value - Field value
 * @param {Array} images - Images collector
 * @param {Array} fields - Fields collector
 * @returns {void}
 */
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

/**
 * Extract localized string (prefer en*).
 * @param {*} value - Possibly localized-value object
 * @returns {string} Text
 */
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

/**
 * Extract preview parts from live Amplience content.
 * @param {Object} content - Live CDN content body
 * @returns {{ fields: Array, images: Array, title: string, body: string, textAlign: string }}
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
            textAlign: textAlign
        };
    }

    var root = content;
    if (isPlainObject(content.content) && content.content._meta) {
        root = content.content;
    }

    // SFCC hero / banner schemas often nest media as img.image
    if (root.img) collectImage('img', root.img, images, fields);
    if (root.image) collectImage('image', root.image, images, fields);
    if (root.backgroundImage) collectImage('backgroundImage', root.backgroundImage, images, fields);
    if (root.bannerImage) collectImage('bannerImage', root.bannerImage, images, fields);
    if (root.heroImage) collectImage('heroImage', root.heroImage, images, fields);

    title = localizedString(root.title)
        || localizedString(root.headline)
        || localizedString(root.heading)
        || firstString(root, ['title', 'headline', 'heading', 'bannerMessage', 'message', 'name'])
        || getMeta(root).name
        || '';
    body = localizedString(root.body)
        || localizedString(root.text)
        || localizedString(root.copy)
        || firstString(root, ['body', 'text', 'copy', 'description', 'richText']);
    textAlign = String(root.textAlign || root.justifyContent || '').trim();

    if (title) fields.push({ name: 'title', type: 'text', value: title });
    if (body) fields.push({ name: 'body', type: 'text', value: body });

    // Fall back to shallow scan for other schemas when no primary image found.
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
        textAlign: textAlign
    };
}

/**
 * Detect widget type from live Amplience content.
 * @param {Object} content - Live CDN content body
 * @returns {string} Widget type id
 */
function detectWidgetType(content) {
    var parts = extractPreviewParts(content);
    var schema = String(getSchemaUri(content) || '').toLowerCase();
    var head = parts.title;
    var body = parts.body;
    var image = parts.images.length ? parts.images[0].url : '';

    if (schema.indexOf('banner') >= 0 || schema.indexOf('hero') >= 0) {
        return image ? WIDGET_TYPES.mainBanner : WIDGET_TYPES.campaignBanner;
    }
    if (schema.indexOf('rich') >= 0 || schema.indexOf('article') >= 0 || schema.indexOf('editorial') >= 0) {
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
 * Merge live CDN content into an existing migrated renderer model.
 * @param {Object} baseModel - Migrated SFCC model
 * @param {Object} liveContent - Live CDN content body
 * @param {string} hubName - Amplience hub name
 * @param {Function} extractSourceFields - Field extractor from amplienceContent helper
 * @param {Function} isMeaningfulMarkup - Markup checker from amplienceContent helper
 * @returns {Object} Updated renderer model
 */
function applyLiveContent(baseModel, liveContent, hubName, extractSourceFields, isMeaningfulMarkup) {
    if (!baseModel || !liveContent) return baseModel;

    var parts = extractPreviewParts(liveContent);
    var widgetType = detectWidgetType(liveContent);
    var source = { item: { content: liveContent } };
    var fields = parts.fields.length ? parts.fields : extractSourceFields(source);
    // Prefer live image only — never keep a stale migrated amplienceImageUrl when CDN has media.
    var imageUrl = parts.images.length ? parts.images[0].url : '';
    var imageId = parts.images.length ? (parts.images[0].id || '') : '';
    if (imageUrl && imageId) {
        imageUrl += (imageUrl.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(imageId);
    }
    var heading = parts.title ? wrapMarkup(parts.title) : baseModel.heading;
    var bodyHtml = wrapMarkup(parts.body || parts.title) || baseModel.bodyHtml;
    var attributes = baseModel.attributes || {};
    var name = parts.title || baseModel.name;

    if (widgetType === WIDGET_TYPES.campaignBanner) {
        bodyHtml = wrapMarkup(parts.title || parts.body) || bodyHtml;
    } else if (widgetType === WIDGET_TYPES.editorialRichText) {
        bodyHtml = wrapMarkup(parts.body || parts.title) || bodyHtml;
    } else if (widgetType === WIDGET_TYPES.mainBanner) {
        heading = wrapMarkup(parts.title || parts.body) || heading;
    } else if (widgetType === WIDGET_TYPES.imageAndText) {
        heading = wrapMarkup(parts.title) || heading;
        bodyHtml = wrapMarkup(parts.body) || bodyHtml;
    }

    return {
        id: baseModel.id,
        name: name,
        description: baseModel.description,
        widgetType: widgetType,
        schema: getSchemaUri(liveContent) || baseModel.schema,
        deliveryKey: baseModel.deliveryKey,
        contentId: baseModel.contentId,
        imageUrl: imageUrl,
        heading: heading,
        bodyHtml: bodyHtml,
        hasBody: isMeaningfulMarkup(bodyHtml),
        attributes: attributes,
        fields: fields,
        images: parts.images,
        textAlign: parts.textAlign || '',
        source: source,
        live: true,
        liveSource: 'cdn',
        liveHubName: hubName || ''
    };
}

module.exports = {
    WIDGET_TYPES: WIDGET_TYPES,
    extractPreviewParts: extractPreviewParts,
    detectWidgetType: detectWidgetType,
    applyLiveContent: applyLiveContent
};
