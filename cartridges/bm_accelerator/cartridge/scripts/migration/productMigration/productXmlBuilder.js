'use strict';

var transformer = require('*/cartridge/scripts/migration/productMigration/productTransformer');
var nativeMap   = require('*/cartridge/scripts/migration/config/nativeFieldMap');

function xmlEsc(val) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&apos;');
}

/** Self-closing tag when value is empty, otherwise wraps value. */
function optTag(tag, val) {
    var v = val ? String(val).trim() : '';
    return v ? '        <' + tag + '>' + xmlEsc(v) + '</' + tag + '>\n'
             : '        <' + tag + '/>\n';
}

/**
 * Build <images> block.
 * Reference uses large + medium + small image-group view-types.
 */
function buildImagesXml(images) {
    if (!images || !images.length) return '';
    var viewTypes = ['large', 'medium', 'small'];
    var xml = '        <images>\n';
    for (var vi = 0; vi < viewTypes.length; vi++) {
        xml += '            <image-group view-type="' + viewTypes[vi] + '">\n';
        for (var i = 0; i < images.length; i++) {
            var url = images[i].url || images[i].path || '';
            if (url) xml += '                <image path="' + xmlEsc(url) + '"/>\n';
        }
        xml += '            </image-group>\n';
    }
    xml += '        </images>\n';
    return xml;
}

/**
 * Build <page-attributes> block.
 * Reference order: page-title → page-description → page-url
 */
function buildPageAttributes(t) {
    var inner = '';
    if (t.metaTitle)        inner += '            <page-title xml:lang="x-default">'        + xmlEsc(t.metaTitle)        + '</page-title>\n';
    if (t.metaDescription)  inner += '            <page-description xml:lang="x-default">'  + xmlEsc(t.metaDescription)  + '</page-description>\n';
    if (t.slug)             inner += '            <page-url xml:lang="x-default">'           + xmlEsc(t.slug)             + '</page-url>\n';
    if (!inner) return '';
    return '        <page-attributes>\n' + inner + '        </page-attributes>\n';
}

/**
 * Build <variations> block with <attributes> (variation axes from CTP variant attrs)
 * and <variants> list.
 * Reference: <attributes> first, then <variants>.
 */
function buildVariationsXml(t) {
    var xml = '        <variations>\n';

    // Collect unique variation attribute names + values across all variants.
    // CTP attribute value can be a string, number, or { key, label } enum.
    var attrMap = {}; // { attrName: { values: { key: displayVal } } }
    for (var vi = 0; vi < t.variants.length; vi++) {
        var attrs = t.variants[vi].attributes || [];
        for (var ai = 0; ai < attrs.length; ai++) {
            var a   = attrs[ai];
            var val = a.value;
            if (val === null || val === undefined) continue;

            var key     = '';
            var display = '';

            if (typeof val === 'object' && !Array.isArray(val)) {
                // CTP lenum/enum: { key: "P2V", label: { "en": "Gray" } }
                if (val.key) {
                    key     = String(val.key).trim();
                    display = (val.label && typeof val.label === 'object')
                        ? (val.label['en'] || val.label[Object.keys(val.label)[0]] || key).trim()
                        : key;
                } else {
                    // plain localized string { "en": "value" }
                    var loc = val['en'] || val['en-US'] || (Object.keys(val).length ? val[Object.keys(val)[0]] : '');
                    key     = String(loc || '').trim();
                    display = key;
                }
            } else {
                key     = String(val).trim();
                display = key;
            }

            // Skip empty or whitespace-only keys (SFCC requires \S|(\S(.*)\S) pattern)
            if (!key) continue;
            // Also skip values that are long text strings (likely descriptions, not variation axes)
            // SFCC limits variation-attribute-value/@value to 256 chars
            if (key.length > 256) continue;
            if (!attrMap[a.name]) attrMap[a.name] = {};
            if (!attrMap[a.name][key]) attrMap[a.name][key] = display;
        }
    }

    var attrNames = Object.keys(attrMap);
    if (attrNames.length) {
        xml += '            <attributes>\n';
        for (var ni = 0; ni < attrNames.length; ni++) {
            var attrName = attrNames[ni];
            xml += '                <variation-attribute attribute-id="' + xmlEsc(attrName)
                + '" variation-attribute-id="' + xmlEsc(attrName) + '">\n';
            xml += '                    <display-name xml:lang="x-default">'
                + xmlEsc(attrName.charAt(0).toUpperCase() + attrName.slice(1))
                + '</display-name>\n';
            xml += '                    <variation-attribute-values>\n';
            var valueKeys = Object.keys(attrMap[attrName]);
            for (var vki = 0; vki < valueKeys.length; vki++) {
                var vKey = valueKeys[vki];
                xml += '                        <variation-attribute-value value="' + xmlEsc(vKey) + '">\n';
                xml += '                            <display-value xml:lang="x-default">'
                    + xmlEsc(attrMap[attrName][vKey])
                    + '</display-value>\n';
                xml += '                        </variation-attribute-value>\n';
            }
            xml += '                    </variation-attribute-values>\n';
            xml += '                </variation-attribute>\n';
        }
        xml += '            </attributes>\n';
    }

    xml += '            <variants>\n';
    for (var vi2 = 0; vi2 < t.variants.length; vi2++) {
        var isDefault = t.variants[vi2].isDefault ? ' default="true"' : '';
        xml += '                <variant product-id="' + xmlEsc(t.variants[vi2].productId) + '"' + isDefault + '/>\n';
    }
    xml += '            </variants>\n';
    xml += '        </variations>\n';
    return xml;
}

/** Shared store-attributes block at end of every product. */
var STORE_ATTRS = '        <store-attributes>\n'
    + '            <force-price-flag>false</force-price-flag>\n'
    + '            <non-inventory-flag>false</non-inventory-flag>\n'
    + '            <non-revenue-flag>false</non-revenue-flag>\n'
    + '            <non-discountable-flag>false</non-discountable-flag>\n'
    + '        </store-attributes>\n';

/**
 * Build product XML + category-assignment XML for one transformed product.
 * Matches reference SFCC catalog XML structure exactly.
 *
 * @returns {{ productXml: string, categoryXml: string }}
 */
function buildProductXml(t) {
    var pid        = xmlEsc(t.productId);
    var productXml = '';
    var catXml     = '';

    // ── Master / simple product ───────────────────────────────────────────
    productXml += '    <product product-id="' + pid + '">\n';
    productXml += optTag('ean',  t.ean);
    productXml += optTag('upc',  t.upc);
    productXml += '        <unit/>\n';
    productXml += '        <min-order-quantity>1</min-order-quantity>\n';
    productXml += '        <step-quantity>1</step-quantity>\n';

    if (t.name)             productXml += '        <display-name xml:lang="x-default">'    + xmlEsc(t.name)             + '</display-name>\n';
    if (t.shortDescription) productXml += '        <short-description xml:lang="x-default">'+ xmlEsc(t.shortDescription) + '</short-description>\n';
    if (t.longDescription)  productXml += '        <long-description xml:lang="x-default">' + xmlEsc(t.longDescription)  + '</long-description>\n';

    productXml += '        <store-force-price-flag>false</store-force-price-flag>\n';
    productXml += '        <store-non-inventory-flag>false</store-non-inventory-flag>\n';
    productXml += '        <store-non-revenue-flag>false</store-non-revenue-flag>\n';
    productXml += '        <store-non-discountable-flag>false</store-non-discountable-flag>\n';
    productXml += '        <online-flag>true</online-flag>\n';
    productXml += '        <available-flag>true</available-flag>\n';
    productXml += '        <searchable-flag>true</searchable-flag>\n';   // reference has this on all product types

    productXml += buildImagesXml(t.masterImages);

    if (t.taxClassId)       productXml += '        <tax-class-id>'       + xmlEsc(t.taxClassId)       + '</tax-class-id>\n';
    if (t.brand)            productXml += '        <brand>'              + xmlEsc(t.brand)            + '</brand>\n';
    if (t.manufacturerName) productXml += '        <manufacturer-name>'  + xmlEsc(t.manufacturerName) + '</manufacturer-name>\n';
    if (t.manufacturerSku)  productXml += '        <manufacturer-sku>'   + xmlEsc(t.manufacturerSku)  + '</manufacturer-sku>\n';

    productXml += buildPageAttributes(t);

    // Custom attrs for CTP tracking (only written if ctp_product_id/key attrs are defined in BM)
    if (t.ctpId || t.ctpKey) {
        productXml += '        <custom-attributes>\n';
        if (t.ctpId)  productXml += '            <custom-attribute attribute-id="ctp_product_id">'  + xmlEsc(t.ctpId)  + '</custom-attribute>\n';
        if (t.ctpKey) productXml += '            <custom-attribute attribute-id="ctp_product_key">' + xmlEsc(t.ctpKey) + '</custom-attribute>\n';
        productXml += '        </custom-attributes>\n';
    }

    // Variations block (master only)
    if (t.hasVariants) productXml += buildVariationsXml(t);

    // classification-category: use first CTP category key if available
    if (t.classificationCategory) {
        productXml += '        <classification-category>' + xmlEsc(t.classificationCategory) + '</classification-category>\n';
    }

    productXml += '        <pinterest-enabled-flag>false</pinterest-enabled-flag>\n';
    productXml += '        <facebook-enabled-flag>false</facebook-enabled-flag>\n';
    productXml += STORE_ATTRS;
    productXml += '    </product>\n\n';

    // ── Variant products ──────────────────────────────────────────────────
    if (t.hasVariants) {
        for (var vi = 0; vi < t.variants.length; vi++) {
            var v = t.variants[vi];
            productXml += '    <product product-id="' + xmlEsc(v.productId) + '">\n';
            productXml += '        <ean/>\n';
            productXml += '        <upc/>\n';
            productXml += '        <unit/>\n';
            productXml += '        <min-order-quantity>1</min-order-quantity>\n';
            productXml += '        <step-quantity>1</step-quantity>\n';
            productXml += '        <online-flag>true</online-flag>\n';
            productXml += '        <available-flag>true</available-flag>\n';
            if (v.sku) productXml += '        <manufacturer-sku>' + xmlEsc(v.sku) + '</manufacturer-sku>\n';

            // Variant custom attrs
            var varInner = t.ctpId ? '            <custom-attribute attribute-id="ctp_product_id">' + xmlEsc(t.ctpId) + '</custom-attribute>\n' : '';
            for (var ai = 0; ai < (v.attributes || []).length; ai++) {
                var a    = v.attributes[ai];
                var val  = a.value;
                if (val === null || val === undefined || typeof val === 'object') continue;
                // Use nativeFieldMap to resolve the SFCC custom attr ID.
                // custom_attr entries have an explicit sfccField; others get ctp_<name>.
                var rule = nativeMap.getRule('commercetools', 'Product', a.name);
                if (rule && rule.action === 'skip') continue;
                var aId  = (rule && rule.action === 'custom_attr') ? rule.sfccField
                    : ('ctp_' + String(a.name || '').replace(/[^a-zA-Z0-9_]/g, '_'));
                varInner += '            <custom-attribute attribute-id="' + xmlEsc(aId) + '">' + xmlEsc(String(val)) + '</custom-attribute>\n';
            }
            if (varInner) productXml += '        <custom-attributes>\n' + varInner + '        </custom-attributes>\n';

            productXml += '        <pinterest-enabled-flag>false</pinterest-enabled-flag>\n';
            productXml += '        <facebook-enabled-flag>false</facebook-enabled-flag>\n';
            productXml += STORE_ATTRS;
            productXml += '    </product>\n\n';
        }
    }

    // ── Category assignments (after ALL products in the file) ─────────────
    for (var ci = 0; ci < t.categories.length; ci++) {
        catXml += '    <category-assignment category-id="' + xmlEsc(t.categories[ci]) + '" product-id="' + pid + '">\n';
        if (ci === 0) catXml += '        <primary-flag>true</primary-flag>\n';
        catXml += '    </category-assignment>\n';
    }

    return { productXml: productXml, categoryXml: catXml };
}

/**
 * Build complete SFCC catalog import XML for a batch of CTP products.
 * @param {Array}  ctpProducts
 * @param {string} catalogId
 * @returns {{ xml: string, built: number, failed: number, errors: Array }}
 */
function buildXml(ctpProducts, catalogId) {
    var built         = 0;
    var failed        = 0;
    var errors        = [];
    var productsXml   = '';
    var categoriesXml = '';

    for (var i = 0; i < ctpProducts.length; i++) {
        try {
            var t      = transformer.transformProduct(ctpProducts[i]);
            var result = buildProductXml(t);
            productsXml   += result.productXml;
            categoriesXml += result.categoryXml;
            built++;
        } catch (e) {
            failed++;
            if (errors.length < 10) {
                errors.push((ctpProducts[i].key || ctpProducts[i].id) + ': ' + (e.message || String(e)));
            }
        }
    }

    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<catalog xmlns="http://www.demandware.com/xml/impex/catalog/2006-10-31"'
            + ' catalog-id="' + xmlEsc(catalogId) + '">\n\n'
            + productsXml
            + categoriesXml
            + '\n</catalog>\n';

    return { xml: xml, built: built, failed: failed, errors: errors };
}

module.exports = { buildXml: buildXml };
