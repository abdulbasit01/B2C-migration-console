'use strict';

var WIDGET_TYPES = {
    campaignBanner:    'campaignBanner',
    editorialRichText: 'editorialRichText',
    mainBanner:        'mainBanner',
    imageAndText:      'imageAndText',
    amplienceWidget:   'amplienceWidget'
};

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
    for (var i = 0; i < keys.length; i++) {
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
        if (imageObj.indexOf('http') === 0 || imageObj.indexOf('//') === 0) return imageObj;
        return '';
    }
    if (imageObj.di) return String(imageObj.di);
    if (imageObj.url) return String(imageObj.url);
    if (imageObj.src) return String(imageObj.src);
    if (imageObj.defaultHost && imageObj.endpoint && imageObj.name) {
        return 'https://' + imageObj.defaultHost + '/i/' + imageObj.endpoint + '/' + imageObj.name;
    }
    return '';
}

function wrapMarkup(text) {
    var value = String(text || '').trim();
    if (!value) return '<p></p>';
    if (value.indexOf('<') >= 0) return value;
    return '<p>' + value + '</p>';
}

function isPlainObject(val) {
    return val && typeof val === 'object' && !Array.isArray(val);
}

function looksLikeImage(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return !!(obj.defaultHost || obj.endpoint || obj.di || obj.name || obj.url || obj.src);
}

/**
 * Flatten useful Amplience fields for preview (strings, images, nested one level).
 * @param {Object} content
 * @returns {{ fields: Array, images: Array, title: string, body: string }}
 */
function extractPreviewParts(content) {
    var fields = [];
    var images = [];
    var title  = '';
    var body   = '';
    var skip   = { _meta: 1, _links: 1 };

    if (!content || typeof content !== 'object') {
        return { fields: fields, images: images, title: title, body: body };
    }

    // Prefer CDN unwrapped content if present
    var root = content;
    if (isPlainObject(content.content) && content.content._meta) {
        root = content.content;
    }

    var keys = Object.keys(root);
    var i;
    for (i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (skip[key]) continue;
        var val = root[key];

        if (typeof val === 'string' && val.trim()) {
            fields.push({ name: key, type: 'text', value: val.trim() });
            if (!title && /^(title|headline|heading|name|label|bannerMessage|message)$/i.test(key)) {
                title = val.trim();
            }
            if (!body && /^(body|text|copy|description|richText|html|content)$/i.test(key)) {
                body = val.trim();
            }
        } else if (looksLikeImage(val)) {
            var imgUrl = buildImageUrl(val);
            if (imgUrl) {
                images.push({ name: key, url: imgUrl });
                fields.push({ name: key, type: 'image', value: imgUrl });
            }
        } else if (Array.isArray(val) && val.length) {
            fields.push({ name: key, type: 'list', value: val.length + ' item(s)' });
            var j;
            for (j = 0; j < Math.min(val.length, 3); j++) {
                if (looksLikeImage(val[j])) {
                    var nestedImg = buildImageUrl(val[j]);
                    if (nestedImg) images.push({ name: key + '[' + j + ']', url: nestedImg });
                } else if (isPlainObject(val[j])) {
                    var nestedTitle = firstString(val[j], ['title', 'headline', 'heading', 'name', 'label', 'text', 'value']);
                    if (nestedTitle) {
                        var localeSuffix = val[j].locale || val[j].lang || j;
                        fields.push({
                            name: key + '[' + localeSuffix + ']',
                            type: 'text',
                            value: nestedTitle
                        });
                    } else if (looksLikeImage(val[j].value)) {
                        var localizedImg = buildImageUrl(val[j].value);
                        if (localizedImg) {
                            images.push({ name: key + '[' + j + ']', url: localizedImg });
                            fields.push({ name: key + '[' + j + ']', type: 'image', value: localizedImg });
                        }
                    }
                } else if (typeof val[j] === 'string' && val[j].trim()) {
                    fields.push({ name: key + '[' + j + ']', type: 'text', value: val[j].trim() });
                }
            }
        } else if (isPlainObject(val)) {
            var nestedHead = firstString(val, ['title', 'headline', 'heading', 'name', 'label', 'text', 'body']);
            if (nestedHead) {
                fields.push({ name: key, type: 'text', value: nestedHead });
                if (!title) title = nestedHead;
            } else {
                fields.push({ name: key, type: 'object', value: Object.keys(val).length + ' properties' });
            }
        }
    }

    if (!title) {
        title = firstString(root, ['headline', 'heading', 'title', 'bannerMessage', 'message', 'name'])
            || getMeta(root).name
            || '';
    }
    if (!body) {
        body = firstString(root, ['body', 'text', 'copy', 'description', 'richText']);
    }

    return {
        fields: fields,
        images: images,
        title:  title,
        body:   body,
        root:   root
    };
}

function detectWidgetType(content) {
    var parts  = extractPreviewParts(content);
    var schema = String(getSchemaUri(parts.root || content) || '').toLowerCase();
    var head   = parts.title;
    var body   = parts.body;
    var image  = parts.images.length ? parts.images[0].url : '';

    if (schema.indexOf('banner') >= 0 || schema.indexOf('hero') >= 0) {
        return image ? WIDGET_TYPES.mainBanner : WIDGET_TYPES.campaignBanner;
    }
    if (schema.indexOf('hotspot') >= 0) {
        return WIDGET_TYPES.amplienceWidget;
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

function mapToWidget(content, deliveryKey, hubName, contentId) {
    var parts      = extractPreviewParts(content);
    var root       = parts.root || content || {};
    var widgetType = detectWidgetType(content);
    var head       = parts.title;
    var body       = parts.body;
    var imageUrl   = parts.images.length ? parts.images[0].url : '';
    var meta       = getMeta(root);
    var schemaUri  = getSchemaUri(root) || meta.schema || '';
    var realKey    = deliveryKey || meta.deliveryKey || '';
    var attributes = {};

    if (widgetType === WIDGET_TYPES.campaignBanner) {
        attributes = { bannerMessage: wrapMarkup(head || body), hubName: hubName || '' };
    } else if (widgetType === WIDGET_TYPES.editorialRichText) {
        attributes = { richText: wrapMarkup(body || head), hubName: hubName || '' };
    } else if (widgetType === WIDGET_TYPES.mainBanner) {
        attributes = {
            heading: head || body || '<p></p>',
            image:   imageUrl,
            hubName: hubName || ''
        };
    } else if (widgetType === WIDGET_TYPES.imageAndText) {
        attributes = {
            heading: head || '<p></p>',
            image:   imageUrl,
            text:    wrapMarkup(body),
            hubName: hubName || ''
        };
    } else {
        attributes = {
            deliveryKey: realKey,
            contentId:   contentId || '',
            hubName:     hubName || '',
            schema:      schemaUri,
            fields:      parts.fields,
            images:      parts.images,
            previewHtml: wrapMarkup(body || head || '')
        };
    }

    // Keep a compact field map for UI preview of the whole component
    attributes.previewFields = parts.fields;
    attributes.previewImages = parts.images;

    return {
        widgetType:     widgetType,
        widgetLabel:    schemaShortName(schemaUri) || widgetType,
        deliveryKey:    realKey,
        contentId:      contentId || '',
        hasDeliveryKey: !!realKey,
        schema:         schemaUri,
        schemaShort:    schemaShortName(schemaUri),
        attributes:     attributes,
        preview: {
            title:   head || meta.name || realKey || contentId || 'Amplience content',
            body:    body,
            image:   imageUrl,
            images:  parts.images,
            fields:  parts.fields,
            schema:  schemaUri
        }
    };
}

/**
 * Transform fetched Amplience payload into an SFCC Page Designer widget mapping.
 * @param {Object} fetched
 * @returns {Object}
 */
function transformFetchedContent(fetched) {
    var content = fetched.content || {};
    var widget = mapToWidget(content, fetched.deliveryKey, fetched.hubName, fetched.contentId);
    widget.source = fetched.rawItem || content;
    widget.sourceMetadata = {
        label:        fetched.label || '',
        status:       fetched.status || '',
        locale:       fetched.locale || '',
        lastModified: fetched.lastModified || '',
        source:       fetched.source || ''
    };
    return widget;
}

module.exports = {
    WIDGET_TYPES:            WIDGET_TYPES,
    detectWidgetType:        detectWidgetType,
    mapToWidget:             mapToWidget,
    transformFetchedContent: transformFetchedContent,
    extractPreviewParts:     extractPreviewParts
};
