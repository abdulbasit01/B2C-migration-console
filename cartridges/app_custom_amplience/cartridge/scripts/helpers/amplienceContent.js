'use strict';

var ContentMgr = require('dw/content/ContentMgr');

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
        return /^(https?:)?\/\//.test(value) ? value : '';
    }
    if (value.di) return String(value.di);
    if (value.url) return String(value.url);
    if (value.src) return String(value.src);
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
    if (!field || field.value == null || field.value === '') return false;
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

        if (fields.length >= 16 || value == null || depth > 4) return;
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
            for (i = 0; i < Math.min(value.length, 6); i++) {
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

/**
 * Select normalized preview fields, falling back to source JSON when needed.
 * @param {Object} attributes - Migrated widget attributes
 * @param {Object} source - Parsed amplienceSourceJson
 * @returns {Array} Preview fields
 */
function normalizeFields(attributes, source) {
    var fields = [];
    if (attributes) {
        fields = attributes.previewFields || attributes.fields || [];
    }
    if (!Array.isArray(fields)) fields = [];

    var renderable = fields.filter(isRenderableField).filter(function (field) {
        // Migration often stores list/object summaries with no useful payload.
        // Prefer real text/image values when available from source instead.
        return field.type === 'text' || field.type === 'image';
    });

    if (!renderable.length) {
        renderable = extractSourceFields(source);
    }

    return renderable;
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
        custom.amplienceImageUrl
        || attributes.image
        || (attributes.previewImages && attributes.previewImages[0]
            && attributes.previewImages[0].url)
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
        name: asset.name || asset.ID,
        description: asset.description || '',
        widgetType: widgetType,
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
 * Load one migrated asset by SFCC content ID.
 * @param {string} contentId - SFCC content ID
 * @returns {Object|null} Renderer model
 */
function getAmplienceAsset(contentId) {
    if (!contentId) return null;
    return resolveFromContentAsset(ContentMgr.getContent(String(contentId)));
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
    var models = [];

    getFolderContent(opts.folderId).forEach(function (asset) {
        var model = resolveFromContentAsset(asset);
        if (model && (!type || model.widgetType === type)) models.push(model);
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

module.exports = {
    FOLDER_ID: FOLDER_ID,
    WIDGET_TYPES: WIDGET_TYPES,
    parseJsonSafe: parseJsonSafe,
    extractSourceFields: extractSourceFields,
    resolveFromContentAsset: resolveFromContentAsset,
    getAmplienceAsset: getAmplienceAsset,
    getAmplienceAssets: getAmplienceAssets,
    sanitizeDeliveryKeyToContentId: sanitizeDeliveryKeyToContentId
};
