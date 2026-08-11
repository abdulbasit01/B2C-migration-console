'use strict';

var core = require('./amplienceCore/transform');

var WIDGET_TYPES = core.WIDGET_TYPES;

/**
 * Merge live CDN content into an existing migrated renderer model.
 * @param {Object} baseModel - Migrated SFCC model
 * @param {Object} liveContent - Live CDN content body
 * @param {string} hubName - Amplience hub name
 * @param {Function} extractSourceFields - Field extractor from amplienceContent helper
 * @param {Function} isMeaningfulMarkup - Markup checker from amplienceContent helper
 * @returns {Object} Updated renderer model
 */
function applyLiveContent(baseModel, liveContent, hubName, extractSourceFields, isMeaningfulMarkup, groupLocalizedPreviewFields, prepareFieldsForView) {
    if (!baseModel || !liveContent) return baseModel;

    var parts = core.extractPreviewParts(liveContent);
    var widgetType = core.detectWidgetType(liveContent);
    var source = { item: { content: liveContent } };
    var rawFields = parts.fields.length ? parts.fields : extractSourceFields(source);
    var groupFn = groupLocalizedPreviewFields || core.groupLocalizedPreviewFields;
    var prepareFn = prepareFieldsForView || function (items) { return items || []; };
    var fields = prepareFn(groupFn(rawFields));
    var imageUrl = parts.images.length ? parts.images[0].url : '';
    var imageId = parts.images.length ? (parts.images[0].id || '') : '';
    if (imageUrl && imageId) {
        imageUrl += (imageUrl.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(imageId);
    }
    var heading = parts.title ? core.wrapMarkup(parts.title) : baseModel.heading;
    var bodyHtml = core.wrapMarkup(parts.body || parts.title) || baseModel.bodyHtml;
    var attributes = baseModel.attributes || {};
    var name = parts.title || baseModel.name;

    if (widgetType === WIDGET_TYPES.campaignBanner) {
        bodyHtml = core.wrapMarkup(parts.title || parts.body) || bodyHtml;
    } else if (widgetType === WIDGET_TYPES.editorialRichText) {
        bodyHtml = core.wrapMarkup(parts.body || '') || bodyHtml;
        heading = core.wrapMarkup(parts.title) || heading;
    } else if (widgetType === WIDGET_TYPES.mainBanner) {
        heading = core.wrapMarkup(parts.title || parts.body) || heading;
    } else if (widgetType === WIDGET_TYPES.imageAndText) {
        heading = core.wrapMarkup(parts.title) || heading;
        bodyHtml = core.wrapMarkup(parts.body) || bodyHtml;
    }

    return {
        id: baseModel.id,
        name: name,
        description: baseModel.description,
        widgetType: widgetType,
        widgetLabel: baseModel.widgetLabel || widgetType,
        schema: (liveContent._meta && liveContent._meta.schema) || baseModel.schema,
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
    extractPreviewParts: core.extractPreviewParts,
    detectWidgetType: core.detectWidgetType,
    applyLiveContent: applyLiveContent
};
