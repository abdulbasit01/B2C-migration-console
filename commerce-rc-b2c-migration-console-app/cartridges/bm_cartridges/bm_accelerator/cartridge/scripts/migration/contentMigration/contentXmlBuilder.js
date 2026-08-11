'use strict';

/**
 * Build SFCC library IMPEX XML for Amplience-mapped content assets.
 * Namespace: http://www.demandware.com/xml/impex/library/2006-10-31
 */

var NS_LIBRARY = 'http://www.demandware.com/xml/impex/library/2006-10-31';
var FOLDER_ID = 'amplience';

function escapeXml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function escapeCdata(value) {
    return String(value == null ? '' : value).replace(/]]>/g, ']]]]><![CDATA[>');
}

/**
 * Build a stable SFCC content-asset ID from delivery key and/or Amplience content id.
 * @param {Object} widget
 * @returns {string}
 */
function sanitizeContentId(widget) {
    var deliveryKey = typeof widget === 'string' ? widget : (widget && widget.deliveryKey);
    var contentId   = typeof widget === 'object' && widget ? widget.contentId : '';
    var raw = String(deliveryKey || contentId || 'amplience-content')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!raw) raw = 'amplience-content';
    if (raw.length > 100) raw = raw.substring(0, 100);
    return 'amp-' + raw;
}

function buildBodyHtml(widget) {
    var preview = widget.preview || {};
    var attrs   = widget.attributes || {};
    if (attrs.richText) return String(attrs.richText);
    if (attrs.bannerMessage) return String(attrs.bannerMessage);
    if (attrs.previewHtml) return String(attrs.previewHtml);
    if (attrs.text) return String(attrs.text);
    if (preview.body) {
        var body = String(preview.body);
        return body.indexOf('<') >= 0 ? body : '<p>' + escapeXml(body) + '</p>';
    }
    if (preview.title) {
        return '<p>' + escapeXml(preview.title) + '</p>';
    }
    return '<p></p>';
}

function buildDescription(widget) {
    var parts = [];
    if (widget.widgetType) parts.push('Widget: ' + widget.widgetType);
    if (widget.schemaShort || widget.schema) parts.push('Schema: ' + (widget.schemaShort || widget.schema));
    if (widget.deliveryKey) parts.push('Delivery key: ' + widget.deliveryKey);
    if (widget.contentId) parts.push('Content ID: ' + widget.contentId);
    return parts.join(' | ') || 'Migrated Amplience content';
}

function buildContentAssetXml(widget) {
    var contentId   = sanitizeContentId(widget);
    var displayName = (widget.preview && widget.preview.title)
        || widget.deliveryKey
        || widget.contentId
        || contentId;
    var bodyHtml    = buildBodyHtml(widget);
    var attrsJson   = JSON.stringify(widget.attributes || {});
    var sourceJson  = JSON.stringify({
        metadata: widget.sourceMetadata || {},
        item:     widget.source || {}
    });
    var lines       = [];

    lines.push('  <content content-id="' + escapeXml(contentId) + '">');
    lines.push('    <display-name xml:lang="x-default">' + escapeXml(displayName) + '</display-name>');
    lines.push('    <description xml:lang="x-default">' + escapeXml(buildDescription(widget)) + '</description>');
    lines.push('    <online-flag>true</online-flag>');
    lines.push('    <searchable-flag>false</searchable-flag>');
    // XSD order: custom-attributes must come before folder-links
    lines.push('    <custom-attributes>');
    lines.push('      <custom-attribute attribute-id="body" xml:lang="x-default"><![CDATA[' + escapeCdata(bodyHtml) + ']]></custom-attribute>');
    lines.push('      <custom-attribute attribute-id="amplienceDeliveryKey">' + escapeXml(widget.deliveryKey || '') + '</custom-attribute>');
    lines.push('      <custom-attribute attribute-id="amplienceContentId">' + escapeXml(widget.contentId || '') + '</custom-attribute>');
    lines.push('      <custom-attribute attribute-id="amplienceWidgetType">' + escapeXml(widget.widgetType || '') + '</custom-attribute>');
    lines.push('      <custom-attribute attribute-id="amplienceSchema">' + escapeXml(widget.schema || '') + '</custom-attribute>');
    lines.push('      <custom-attribute attribute-id="amplienceWidgetAttributes"><![CDATA[' + escapeCdata(attrsJson) + ']]></custom-attribute>');
    lines.push('      <custom-attribute attribute-id="amplienceSourceJson"><![CDATA[' + escapeCdata(sourceJson) + ']]></custom-attribute>');
    if (widget.preview && widget.preview.image) {
        lines.push('      <custom-attribute attribute-id="amplienceImageUrl">' + escapeXml(widget.preview.image) + '</custom-attribute>');
    }
    lines.push('    </custom-attributes>');
    lines.push('    <folder-links>');
    lines.push('      <classification-link folder-id="' + FOLDER_ID + '"/>');
    lines.push('    </folder-links>');
    lines.push('  </content>');
    return lines.join('\n');
}

/**
 * Resolve default library id = current site private library (site ID).
 * Falls back to AmplienceSharedLibrary when Site is unavailable.
 * @param {string} [libraryId]
 * @returns {string}
 */
function resolveLibraryId(libraryId) {
    if (libraryId) return String(libraryId);
    try {
        var Site = require('dw/system/Site');
        var site = Site.getCurrent();
        if (site && site.getID()) return site.getID();
    } catch (e) {
        // BM / non-request context
    }
    return 'AmplienceSharedLibrary';
}

/**
 * @param {Object[]} widgets - transformed Amplience widgets
 * @param {string} [libraryId]
 * @param {Object} [opts]
 * @param {boolean} [opts.close=true] - whether to write the closing </library> tag
 * @returns {{ xml: string, built: number, contentIds: string[], libraryId: string }}
 */
function buildXml(widgets, libraryId, opts) {
    var options = opts || {};
    var closeLibrary = options.close !== false;
    var libId = resolveLibraryId(libraryId);
    var parts = [];
    var ids   = [];
    var i;

    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    parts.push('<library xmlns="' + NS_LIBRARY + '" library-id="' + escapeXml(libId) + '">');
    parts.push('  <folder folder-id="' + FOLDER_ID + '">');
    parts.push('    <display-name xml:lang="x-default">Amplience Migrated</display-name>');
    parts.push('    <description xml:lang="x-default">Content assets migrated from Amplience CMS</description>');
    parts.push('    <online-flag>true</online-flag>');
    parts.push('  </folder>');

    for (i = 0; i < (widgets || []).length; i++) {
        var widget = widgets[i];
        if (!widget) continue;
        parts.push(buildContentAssetXml(widget));
        ids.push(sanitizeContentId(widget));
    }

    if (closeLibrary) {
        parts.push('</library>');
    }
    return {
        xml:        parts.join('\n') + '\n',
        built:      ids.length,
        contentIds: ids,
        libraryId:  libId
    };
}

module.exports = {
    NS_LIBRARY:           NS_LIBRARY,
    FOLDER_ID:            FOLDER_ID,
    sanitizeContentId:    sanitizeContentId,
    buildContentAssetXml: buildContentAssetXml,
    resolveLibraryId:     resolveLibraryId,
    escapeCdata:          escapeCdata,
    buildXml:             buildXml
};
