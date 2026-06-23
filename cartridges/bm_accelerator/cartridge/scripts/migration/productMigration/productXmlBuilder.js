'use strict';

var transformer = require('*/cartridge/scripts/migration/productMigration/productTransformer');

function xmlEsc(val) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&apos;');
}

function buildImagesXml(images, indent) {
    if (!images || !images.length) return '';
    var pad = indent || '        ';
    var xml = pad + '<images>\n';
    xml += pad + '    <image-group view-type="large">\n';
    for (var i = 0; i < images.length; i++) {
        var url = images[i].url || images[i].path || '';
        if (url) xml += pad + '        <image path="' + xmlEsc(url) + '"/>\n';
    }
    xml += pad + '    </image-group>\n';
    xml += pad + '</images>\n';
    return xml;
}

function buildVariantCustomAttrs(ctpId, attributes) {
    var xml = '        <custom-attributes>\n';
    xml += '            <custom-attribute attribute-id="ctp_product_id">' + xmlEsc(ctpId) + '</custom-attribute>\n';
    if (attributes && attributes.length) {
        for (var ai = 0; ai < attributes.length; ai++) {
            var a    = attributes[ai];
            var aVal = a.value;
            if (aVal !== null && aVal !== undefined && typeof aVal !== 'object') {
                var aId = 'ctp_' + String(a.name || '').replace(/[^a-zA-Z0-9_]/g, '_');
                xml += '            <custom-attribute attribute-id="' + xmlEsc(aId) + '">' + xmlEsc(String(aVal)) + '</custom-attribute>\n';
            }
        }
    }
    xml += '        </custom-attributes>\n';
    return xml;
}

function buildProductXml(transformed) {
    var pid = xmlEsc(transformed.productId);
    var xml = '';

    if (transformed.hasVariants) {
        // ── Master product ────────────────────────────────────────────────
        xml += '    <product product-id="' + pid + '">\n';
        if (transformed.name)        xml += '        <display-name xml:lang="x-default">' + xmlEsc(transformed.name)        + '</display-name>\n';
        if (transformed.description) xml += '        <long-description xml:lang="x-default">' + xmlEsc(transformed.description) + '</long-description>\n';
        if (transformed.slug)        xml += '        <page-url xml:lang="x-default">' + xmlEsc(transformed.slug) + '</page-url>\n';
        xml += '        <online-flag>true</online-flag>\n';
        xml += '        <available-flag>true</available-flag>\n';
        xml += '        <searchable-flag>true</searchable-flag>\n';
        xml += '        <variations>\n';
        xml += '            <variants>\n';
        for (var vi = 0; vi < transformed.variants.length; vi++) {
            var isDefault = transformed.variants[vi].isDefault ? ' default="true"' : '';
            xml += '                <variant product-id="' + xmlEsc(transformed.variants[vi].productId) + '"' + isDefault + '/>\n';
        }
        xml += '            </variants>\n';
        xml += '        </variations>\n';
        xml += '        <custom-attributes>\n';
        xml += '            <custom-attribute attribute-id="ctp_product_id">' + xmlEsc(transformed.ctpId) + '</custom-attribute>\n';
        if (transformed.ctpKey) {
            xml += '            <custom-attribute attribute-id="ctp_product_key">' + xmlEsc(transformed.ctpKey) + '</custom-attribute>\n';
        }
        xml += '        </custom-attributes>\n';
        xml += '    </product>\n';

        // ── Variant products ──────────────────────────────────────────────
        for (var vi2 = 0; vi2 < transformed.variants.length; vi2++) {
            var variant = transformed.variants[vi2];
            xml += '    <product product-id="' + xmlEsc(variant.productId) + '">\n';
            xml += '        <online-flag>true</online-flag>\n';
            xml += '        <available-flag>true</available-flag>\n';
            xml += buildImagesXml(variant.images, '        ');
            xml += buildVariantCustomAttrs(transformed.ctpId, variant.attributes);
            xml += '    </product>\n';
        }

    } else {
        // ── Simple product (no variants) ──────────────────────────────────
        var masterVariant = transformed.variants && transformed.variants[0];
        xml += '    <product product-id="' + pid + '">\n';
        if (transformed.name)        xml += '        <display-name xml:lang="x-default">' + xmlEsc(transformed.name)        + '</display-name>\n';
        if (transformed.description) xml += '        <long-description xml:lang="x-default">' + xmlEsc(transformed.description) + '</long-description>\n';
        if (transformed.slug)        xml += '        <page-url xml:lang="x-default">' + xmlEsc(transformed.slug) + '</page-url>\n';
        xml += '        <online-flag>true</online-flag>\n';
        xml += '        <available-flag>true</available-flag>\n';
        xml += '        <searchable-flag>true</searchable-flag>\n';
        if (masterVariant) xml += buildImagesXml(masterVariant.images, '        ');
        xml += '        <custom-attributes>\n';
        xml += '            <custom-attribute attribute-id="ctp_product_id">' + xmlEsc(transformed.ctpId) + '</custom-attribute>\n';
        if (transformed.ctpKey) {
            xml += '            <custom-attribute attribute-id="ctp_product_key">' + xmlEsc(transformed.ctpKey) + '</custom-attribute>\n';
        }
        xml += '        </custom-attributes>\n';
        xml += '    </product>\n';
    }

    // ── Category assignments ──────────────────────────────────────────────
    for (var cai = 0; cai < transformed.categories.length; cai++) {
        xml += '    <category-assignment product-id="' + pid + '" category-id="' + xmlEsc(transformed.categories[cai]) + '">\n';
        if (cai === 0) xml += '        <primary-flag>true</primary-flag>\n';
        xml += '    </category-assignment>\n';
    }

    return xml;
}

/**
 * Build SFCC catalog import XML for a batch of CTP product objects.
 * @param {Array}  ctpProducts - raw CTP products from ctpProductFetcher
 * @param {string} catalogId   - target SFCC catalog ID
 * @returns {{ xml: string, built: number, failed: number, errors: Array }}
 */
function buildXml(ctpProducts, catalogId) {
    var built  = 0;
    var failed = 0;
    var errors = [];
    var body   = '';

    for (var i = 0; i < ctpProducts.length; i++) {
        try {
            var transformed = transformer.transformProduct(ctpProducts[i]);
            body += buildProductXml(transformed);
            built++;
        } catch (e) {
            failed++;
            if (errors.length < 5) {
                errors.push((ctpProducts[i].key || ctpProducts[i].id) + ': ' + (e.message || String(e)));
            }
        }
    }

    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<catalog xmlns="http://www.demandware.com/xml/impex/catalog/2006-10-31"'
            + ' catalog-id="' + xmlEsc(catalogId) + '">\n'
            + body
            + '</catalog>\n';

    return { xml: xml, built: built, failed: failed, errors: errors };
}

module.exports = { buildXml: buildXml };
