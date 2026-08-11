'use strict';

var cdn = require('./cdn');
var transform = require('./transform');
var fetchApi = require('./fetch');

module.exports = {
    WIDGET_TYPES: transform.WIDGET_TYPES,
    WIDGET_TYPE_FILTERS: transform.WIDGET_TYPE_FILTERS,
    buildCdnUrl: cdn.buildCdnUrl,
    buildCdnUrlById: cdn.buildCdnUrlById,
    extractPreviewParts: transform.extractPreviewParts,
    extractPreviewPartsForLocale: transform.extractPreviewPartsForLocale,
    detectWidgetType: transform.detectWidgetType,
    mapToWidget: transform.mapToWidget,
    transformFetchedContent: transform.transformFetchedContent,
    toRendererModel: transform.toRendererModel,
    isMeaningfulMarkup: transform.isMeaningfulMarkup,
    wrapMarkup: transform.wrapMarkup,
    groupLocalizedPreviewFields: transform.groupLocalizedPreviewFields,
    unwrapCdnPayload: fetchApi.unwrapCdnPayload,
    fetchLiveContent: fetchApi.fetchLiveContent
};
