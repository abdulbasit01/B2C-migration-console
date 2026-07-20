'use strict';

var ctpTransformer   = require('*/cartridge/scripts/migration/productMigration/productTransformer');
var nativeMap        = require('*/cartridge/scripts/migration/config/nativeFieldMap');
var attrIdMapSession = require('*/cartridge/scripts/migration/core/attrIdMapSession');

function xmlEsc(val) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&apos;');
}

/**
 * Resolve SFCC product attribute ID, applying visit-scoped renames.
 * @param {string} canonicalSfccId
 * @returns {string}
 */
function resolveProductAttrId(canonicalSfccId) {
    return attrIdMapSession.resolve(canonicalSfccId, attrIdMapSession.read('product'));
}

var UUID_RE_XML = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Convert a CTP member product UUID to its SFCC product ID.
 * Uses the batch lookup map (populated in buildXml) so member references
 * resolve to the same ID the product itself uses in the catalog XML.
 */
var _uuidToSfccId = {};
function ctpMemberIdToSfcc(ctpId) {
    if (!ctpId) return '';
    var s = String(ctpId);
    if (UUID_RE_XML.test(s)) {
        return _uuidToSfccId[s] || ('CTP' + s.replace(/-/g, ''));
    }
    return s;
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
 * Build <variations> block with <attributes> (variation axes from variant attrs)
 * and <variants> list.
 * Reference: <attributes> first, then <variants>.
 * isShopify: true when the product comes from the Shopify transformer.
 */
function buildVariationsXml(t, selectedVarAttrs, isShopify) {
    var xml = '        <variations>\n';
    var hasVarSelection = selectedVarAttrs && selectedVarAttrs.length;
    var attrPrefix = isShopify ? 'shopify_' : 'ctp_';

    // Collect unique variation attribute names + values across all variants.
    // CTP: value can be string, number, or { key, label } enum.
    // Shopify: value is always a string (selectedOptions).
    // attrMap key = SFCC attr ID (prefixed) — must match both axis ID and variant custom attr ID.
    var attrMap = {}; // { sfccAttrId: { key: displayVal } }
    for (var vi = 0; vi < t.variants.length; vi++) {
        var attrs = t.variants[vi].attributes || [];
        for (var ai = 0; ai < attrs.length; ai++) {
            var a   = attrs[ai];
            var val = a.value;
            if (val === null || val === undefined) continue;
            // CTP: only include axes that are in the selected variant attrs list (or none if unset).
            // Shopify: include all when unset; when set, include selected options (+ price/barcode extras).
            if (isShopify) {
                if (hasVarSelection
                    && selectedVarAttrs.indexOf(a.name) === -1
                    && a.name !== 'price' && a.name !== 'compareAtPrice' && a.name !== 'barcode') {
                    continue;
                }
            } else {
                if (hasVarSelection && selectedVarAttrs.indexOf(a.name) === -1) continue;
                if (!hasVarSelection) continue;
            }

            var axisRule = nativeMap.getRule(isShopify ? 'shopify' : 'commercetools', 'Product', a.name);
            if (axisRule && axisRule.action === 'skip') continue;
            // Use same SFCC ID as variant custom attr so axis ID and value ID match.
            // custom_attr rules map to a native SFCC field (e.g. Shopify "Color" -> "color")
            // instead of the platform-prefixed custom attribute ID.
            var sfccAxisId = (axisRule && axisRule.action === 'custom_attr') ? axisRule.sfccField
                : (attrPrefix + String(a.name || '').replace(/[^a-zA-Z0-9_]/g, '_'));
            sfccAxisId = resolveProductAttrId(sfccAxisId);

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
            // Skip long text strings — not suitable as variation axis values (SFCC limit 256 chars)
            if (key.length > 256) continue;
            if (!attrMap[sfccAxisId]) attrMap[sfccAxisId] = {};
            if (!attrMap[sfccAxisId][key]) attrMap[sfccAxisId][key] = display;
        }
    }

    var attrNames = Object.keys(attrMap);
    if (attrNames.length) {
        xml += '            <attributes>\n';
        for (var ni = 0; ni < attrNames.length; ni++) {
            var attrName = attrNames[ni]; // SFCC attr ID (ctp_ prefixed)
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

/**
 * Build <product-set-products> block per SFCC catalog XSD.
 * XSD: complexType.Product.ProductSetProducts → unbounded <product-set-product product-id="..."/>
 */
function buildProductSetProductsXml(setProducts) {
    if (!setProducts || !setProducts.length) return '';
    var xml = '        <product-set-products>\n';
    for (var i = 0; i < setProducts.length; i++) {
        xml += '            <product-set-product product-id="' + xmlEsc(ctpMemberIdToSfcc(setProducts[i].productId)) + '"/>\n';
    }
    xml += '        </product-set-products>\n';
    return xml;
}

/**
 * Build <bundled-products> block per SFCC catalog XSD.
 * XSD: complexType.Product.BundledProduct → attribute product-id + required child <quantity>
 */
function buildBundledProductsXml(bundleProducts) {
    if (!bundleProducts || !bundleProducts.length) {
        return '';
    }
    var xml = '        <bundled-products>\n';
    for (var i = 0; i < bundleProducts.length; i++) {
        var qty = bundleProducts[i].quantity || 1;
        xml += '            <bundled-product product-id="' + xmlEsc(ctpMemberIdToSfcc(bundleProducts[i].productId)) + '">\n';
        xml += '                <quantity>' + qty + '</quantity>\n';
        xml += '            </bundled-product>\n';
    }
    xml += '        </bundled-products>\n';
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
function buildProductXml(t, selectedVarAttrs) {
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

    productXml += '        <online-flag>true</online-flag>\n';
    productXml += '        <available-flag>true</available-flag>\n';
    productXml += '        <searchable-flag>true</searchable-flag>\n';
    productXml += '        <searchable-if-unavailable-flag>false</searchable-if-unavailable-flag>\n';

    // Images skipped — CTP image URLs are external and incompatible with SFCC DIS path format

    if (t.taxClassId)       productXml += '        <tax-class-id>'       + xmlEsc(t.taxClassId)       + '</tax-class-id>\n';
    if (t.brand)            productXml += '        <brand>'              + xmlEsc(t.brand)            + '</brand>\n';
    if (t.manufacturerName) productXml += '        <manufacturer-name>'  + xmlEsc(t.manufacturerName) + '</manufacturer-name>\n';
    if (t.manufacturerSku)  productXml += '        <manufacturer-sku>'   + xmlEsc(t.manufacturerSku)  + '</manufacturer-sku>\n';

    productXml += buildPageAttributes(t);

    var isShopify = !!t.shopifyId;

    // Custom attrs for source-platform tracking (respect visit-scoped renames)
    if (isShopify) {
        productXml += '        <custom-attributes>\n';
        productXml += '            <custom-attribute attribute-id="' + xmlEsc(resolveProductAttrId('shopify_product_id')) + '">' + xmlEsc(t.shopifyId)  + '</custom-attribute>\n';
        productXml += '            <custom-attribute attribute-id="' + xmlEsc(resolveProductAttrId('shopify_handle')) + '">'     + xmlEsc(t.productId) + '</custom-attribute>\n';
        if (t.shopifyStatus) {
            productXml += '            <custom-attribute attribute-id="' + xmlEsc(resolveProductAttrId('shopify_status')) + '">' + xmlEsc(t.shopifyStatus) + '</custom-attribute>\n';
        }
        productXml += '        </custom-attributes>\n';
    } else if (t.ctpId || t.ctpKey) {
        productXml += '        <custom-attributes>\n';
        if (t.ctpId)       productXml += '            <custom-attribute attribute-id="' + xmlEsc(resolveProductAttrId('ctp_product_id')) + '">'   + xmlEsc(t.ctpId)       + '</custom-attribute>\n';
        if (t.ctpKey)      productXml += '            <custom-attribute attribute-id="' + xmlEsc(resolveProductAttrId('ctp_product_key')) + '">'  + xmlEsc(t.ctpKey)      + '</custom-attribute>\n';
        if (t.productKind) productXml += '            <custom-attribute attribute-id="' + xmlEsc(resolveProductAttrId('ctp_product_type')) + '">' + xmlEsc(t.productKind) + '</custom-attribute>\n';
        productXml += '        </custom-attributes>\n';
    }

    // XSD-enforced order: bundled-products → product-set-products → variations
    if (t.productKind === 'bundle') {
        productXml += buildBundledProductsXml(t.bundleProducts);
    } else if (t.productKind === 'set') {
        productXml += buildProductSetProductsXml(t.setProducts);
    } else if (t.hasVariants) {
        // base product with variants
        productXml += buildVariationsXml(t, selectedVarAttrs, isShopify);
    }

    // classification-category: use first CTP category key if available
    if (t.classificationCategory) {
        productXml += '        <classification-category>' + xmlEsc(t.classificationCategory) + '</classification-category>\n';
    }

    productXml += '        <pinterest-enabled-flag>false</pinterest-enabled-flag>\n';
    productXml += '        <facebook-enabled-flag>false</facebook-enabled-flag>\n';
    productXml += STORE_ATTRS;
    productXml += '    </product>\n\n';

    // ── Variant products (base products only — sets/bundles have no SFCC variants) ──
    if (t.productKind === 'base' && t.hasVariants) {
        var isShopifyVar = !!t.shopifyId;
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

            var varInner;
            var hasVarSelection = selectedVarAttrs && selectedVarAttrs.length;

            if (isShopifyVar) {
                // Shopify: respect selection when set; always keep price/barcode extras + parent link
                varInner = t.shopifyId
                    ? '            <custom-attribute attribute-id="' + xmlEsc(resolveProductAttrId('shopify_product_id')) + '">' + xmlEsc(t.shopifyId) + '</custom-attribute>\n'
                    : '';
                for (var sai = 0; sai < (v.attributes || []).length; sai++) {
                    var sa    = v.attributes[sai];
                    var sval  = sa.value;
                    if (sval === null || sval === undefined) continue;
                    if (Array.isArray(sval)) continue;
                    if (hasVarSelection
                        && selectedVarAttrs.indexOf(sa.name) === -1
                        && sa.name !== 'price' && sa.name !== 'compareAtPrice' && sa.name !== 'barcode') {
                        continue;
                    }
                    var saRule = nativeMap.getRule('shopify', 'Product', sa.name);
                    if (saRule && saRule.action === 'skip') continue;
                    var saId  = (saRule && saRule.action === 'custom_attr') ? saRule.sfccField
                        : ('shopify_' + String(sa.name || '').replace(/[^a-zA-Z0-9_]/g, '_'));
                    saId = resolveProductAttrId(saId);
                    var sstr  = String(sval);
                    if (!sstr) continue;
                    varInner += '            <custom-attribute attribute-id="' + xmlEsc(saId) + '">' + xmlEsc(sstr) + '</custom-attribute>\n';
                }
            } else {
                // CTP: only write attrs the user explicitly selected.
                varInner = t.ctpId
                    ? '            <custom-attribute attribute-id="' + xmlEsc(resolveProductAttrId('ctp_product_id')) + '">' + xmlEsc(t.ctpId) + '</custom-attribute>\n'
                    : '';
                for (var ai = 0; ai < (v.attributes || []).length; ai++) {
                    var a    = v.attributes[ai];
                    var val  = a.value;
                    if (val === null || val === undefined) continue;
                    // Require explicit selection — skip if no selection or attr not selected.
                    if (!hasVarSelection || selectedVarAttrs.indexOf(a.name) === -1) continue;
                    // Use SFCC attr ID (ctp_ prefixed) — must match the variation axis ID on the master.
                    var rule = nativeMap.getRule('commercetools', 'Product', a.name);
                    if (rule && rule.action === 'skip') continue;
                    var aId  = (rule && rule.action === 'custom_attr') ? rule.sfccField
                        : ('ctp_' + String(a.name || '').replace(/[^a-zA-Z0-9_]/g, '_'));
                    aId = resolveProductAttrId(aId);
                    var strVal;
                    if (typeof val === 'object' && !Array.isArray(val)) {
                        // CTP enum/lenum: { key, label }
                        if (val.key !== undefined && val.key !== null) {
                            strVal = String(val.key);
                        } else {
                            // Localized string: { "en": "value" }
                            var loc = val['en'] || val['en-US'] || (Object.keys(val).length ? val[Object.keys(val)[0]] : '');
                            strVal = String(loc || '');
                        }
                    } else if (Array.isArray(val)) {
                        continue; // skip array values for custom attrs
                    } else {
                        strVal = String(val);
                    }
                    if (!strVal) continue;
                    varInner += '            <custom-attribute attribute-id="' + xmlEsc(aId) + '">' + xmlEsc(strVal) + '</custom-attribute>\n';
                }
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
 * Build product and category XML parts for a batch — no XML declaration or catalog wrapper.
 * Returns the inner parts separately so callers can accumulate across multiple batches
 * and write a single XML file at the end.
 *
 * @param {Array}    rawProducts
 * @param {string}   catalogId        - used only for UUID→SFCC-ID map key; not written here
 * @param {Array}    selectedVarAttrs
 * @param {Function} [transformerFn]
 * @returns {{ productsXml, categoriesXml, built, failed, errors, setCount, bundleCount }}
 */
function buildXmlParts(rawProducts, catalogId, selectedVarAttrs, transformerFn) {
    var transform = transformerFn || ctpTransformer.transformProduct;

    _uuidToSfccId = {};
    for (var mi = 0; mi < rawProducts.length; mi++) {
        var cp    = rawProducts[mi];
        var cpId  = cp.id  || '';
        var cpKey = cp.key || cp.handle || '';
        if (cpId) {
            _uuidToSfccId[cpId] = cpKey
                ? String(cpKey).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 100)
                : ('CTP' + cpId.replace(/-/g, ''));
        }
    }

    var built         = 0;
    var failed        = 0;
    var errors        = [];
    var setCount      = 0;
    var bundleCount   = 0;
    var productsXml   = '';
    var categoriesXml = '';

    for (var i = 0; i < rawProducts.length; i++) {
        try {
            var t      = transform(rawProducts[i]);
            var result = buildProductXml(t, selectedVarAttrs);
            productsXml   += result.productXml;
            categoriesXml += result.categoryXml;
            if (t.productKind === 'set')    setCount++;
            else if (t.productKind === 'bundle') bundleCount++;
            built++;
        } catch (e) {
            failed++;
            if (errors.length < 10) {
                errors.push((rawProducts[i].key || rawProducts[i].handle || rawProducts[i].id) + ': ' + (e.message || String(e)));
            }
        }
    }

    return {
        productsXml:   productsXml,
        categoriesXml: categoriesXml,
        built:         built,
        failed:        failed,
        errors:        errors,
        setCount:      setCount,
        bundleCount:   bundleCount
    };
}

/**
 * Build complete SFCC catalog import XML for a batch of products.
 * For single-batch usage (partial migration or Shopify). For multi-batch CTP full migration
 * use buildXmlParts + assemble manually to produce one file.
 *
 * @param {Array}    rawProducts
 * @param {string}   catalogId
 * @param {Array}    selectedVarAttrs
 * @param {Function} [transformerFn]
 * @returns {{ xml, built, failed, errors, setCount, bundleCount }}
 */
function buildXml(rawProducts, catalogId, selectedVarAttrs, transformerFn) {
    var parts = buildXmlParts(rawProducts, catalogId, selectedVarAttrs, transformerFn);

    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<catalog xmlns="http://www.demandware.com/xml/impex/catalog/2006-10-31"'
            + ' catalog-id="' + xmlEsc(catalogId) + '">\n\n'
            + parts.productsXml
            + parts.categoriesXml
            + '\n</catalog>\n';

    return {
        xml:         xml,
        built:       parts.built,
        failed:      parts.failed,
        errors:      parts.errors,
        setCount:    parts.setCount,
        bundleCount: parts.bundleCount
    };
}

function xmlHeader(catalogId) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<catalog xmlns="http://www.demandware.com/xml/impex/catalog/2006-10-31"'
        + ' catalog-id="' + xmlEsc(catalogId) + '">\n\n';
}

var XML_FOOTER = '\n</catalog>\n';

module.exports = {
    buildXml:      buildXml,
    buildXmlParts: buildXmlParts,
    xmlHeader:     xmlHeader,
    XML_FOOTER:    XML_FOOTER
};
