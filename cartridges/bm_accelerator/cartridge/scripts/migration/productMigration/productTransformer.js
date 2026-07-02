'use strict';

/**
 * Detect whether a CTP product is a base/variant product, a product set, or a bundle.
 * CTP doesn't have a native set/bundle type — detection is by:
 *   1. productType.obj.name containing "bundle" or "set" (when expanded)
 *   2. master-variant attribute whose value is an array of product references
 *      - [{typeId:"product", id:"..."}]              → set (no quantity)
 *      - [{product:{typeId:"product",...}, quantity}] → bundle (has quantity)
 */
function detectProductKind(ctpProduct, data) {
    var ptName = '';
    if (ctpProduct.productType && ctpProduct.productType.obj) {
        ptName = String(ctpProduct.productType.obj.name || '').toLowerCase();
    }

    var mvAttrs = (data.masterVariant && data.masterVariant.attributes) || [];
    for (var i = 0; i < mvAttrs.length; i++) {
        var val = mvAttrs[i].value;
        if (!Array.isArray(val) || !val.length) continue;
        var first = val[0];
        if (!first || typeof first !== 'object') continue;

        // [{product: {typeId:"product", id:"..."}, quantity: N}] — bundle
        if (first.product && first.product.typeId === 'product' && first.quantity != null) {
            return 'bundle';
        }
        // [{typeId:"product", id:"..."}] — set (direct product refs, no quantity)
        if (first.typeId === 'product' && first.id) {
            return 'set';
        }
        // [{value: {typeId:"product", id:"..."}}] — set (nested ref)
        if (first.value && first.value.typeId === 'product' && first.value.id) {
            return 'set';
        }
    }

    if (ptName.indexOf('bundle') !== -1) return 'bundle';
    if (ptName.indexOf('set') !== -1)    return 'set';

    return 'base';
}

/**
 * Extract member product IDs for a product set from CTP master-variant attributes.
 * Returns [{productId: string}]
 */
function extractSetProducts(data) {
    var mvAttrs = (data.masterVariant && data.masterVariant.attributes) || [];
    for (var i = 0; i < mvAttrs.length; i++) {
        var val = mvAttrs[i].value;
        if (!Array.isArray(val) || !val.length) continue;
        var first = val[0];
        if (!first || typeof first !== 'object') continue;

        var members = [];

        if (first.typeId === 'product' && first.id) {
            for (var j = 0; j < val.length; j++) {
                if (val[j] && val[j].typeId === 'product' && val[j].id) {
                    members.push({ productId: val[j].id });
                }
            }
        } else if (first.value && first.value.typeId === 'product' && first.value.id) {
            for (var k = 0; k < val.length; k++) {
                if (val[k] && val[k].value && val[k].value.id) {
                    members.push({ productId: val[k].value.id });
                }
            }
        }

        if (members.length) return members;
    }
    return [];
}

/**
 * Extract bundled component product IDs + quantities from CTP master-variant attributes.
 * Returns [{productId: string, quantity: number}]
 */
function extractBundleProducts(data) {
    var mvAttrs = (data.masterVariant && data.masterVariant.attributes) || [];
    for (var i = 0; i < mvAttrs.length; i++) {
        var val = mvAttrs[i].value;
        if (!Array.isArray(val) || !val.length) continue;
        var first = val[0];
        if (!first || typeof first !== 'object') continue;

        if (first.product && first.product.typeId === 'product' && first.quantity != null) {
            var components = [];
            for (var j = 0; j < val.length; j++) {
                var item = val[j];
                if (item && item.product && item.product.id) {
                    components.push({
                        productId: item.product.id,
                        quantity:  Number(item.quantity) || 1
                    });
                }
            }
            if (components.length) return components;
        }
    }
    return [];
}

function getLocalized(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return obj['en'] || obj['en-US'] || obj['en-GB']
        || (Object.keys(obj).length > 0 ? obj[Object.keys(obj)[0]] : '') || '';
}

function hasLocalized(obj) {
    return obj && typeof obj === 'object' && Object.keys(obj).length > 0;
}

function sanitizeId(str) {
    if (!str) return '';
    return String(str)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 100);
}

/**
 * Extract a named attribute value from a CTP attributes array.
 * Handles plain values and localized values { "en": "..." }.
 */
function getAttrValue(attributes, attrName) {
    if (!attributes || !attributes.length) return '';
    for (var i = 0; i < attributes.length; i++) {
        if (attributes[i].name === attrName) {
            var val = attributes[i].value;
            if (val === null || val === undefined) return '';
            if (typeof val === 'object' && !Array.isArray(val)) {
                return getLocalized(val) || '';
            }
            return String(val);
        }
    }
    return '';
}

function transformProduct(ctpProduct) {
    var md     = ctpProduct.masterData || {};
    var cur    = md.current || {};
    var staged = md.staged  || {};

    // Use staged when current has no name (unpublished products have empty current)
    var data = hasLocalized(cur.name) ? cur : staged;

    var productKind   = detectProductKind(ctpProduct, data);
    var setProducts   = productKind === 'set'    ? extractSetProducts(data)    : [];
    var bundleProducts = productKind === 'bundle' ? extractBundleProducts(data) : [];

    var mv      = data.masterVariant || {};
    var ctpVars = data.variants || [];
    var mvAttrs = mv.attributes || [];

    var ctpKey   = ctpProduct.key || '';
    var masterId = ctpKey
        ? sanitizeId(ctpKey)
        : ('CTP' + String(ctpProduct.id).replace(/-/g, ''));

    // Standard localized fields
    var name = getLocalized(data.name);

    // SFCC <short-description> = BM "Description" ← CTP shortDescription attribute
    var shortDescription = getAttrValue(mvAttrs, 'shortDescription')
        || getAttrValue(mvAttrs, 'short_description')
        || getLocalized(data.description)
        || '';

    // SFCC <long-description> = BM "Product Details" ← CTP longDescription attribute
    var longDescription = getAttrValue(mvAttrs, 'longDescription')
        || getAttrValue(mvAttrs, 'long_description')
        || getAttrValue(mvAttrs, 'productDetails')
        || '';

    var slug            = getLocalized(data.slug) || '';
    var metaTitle       = getLocalized(data.metaTitle) || '';
    var metaDescription = getLocalized(data.metaDescription) || '';
    var metaKeywords    = getLocalized(data.metaKeywords) || '';

    // Product-level fields from master variant attributes
    var brand            = getAttrValue(mvAttrs, 'brand') || getAttrValue(mvAttrs, 'Brand') || '';
    var manufacturerName = getAttrValue(mvAttrs, 'manufacturer') || getAttrValue(mvAttrs, 'manufacturerName') || '';
    var manufacturerSku  = mv.sku || '';
    var ean              = getAttrValue(mvAttrs, 'ean') || getAttrValue(mvAttrs, 'EAN') || mv.ean || '';
    var upc              = getAttrValue(mvAttrs, 'upc') || getAttrValue(mvAttrs, 'UPC') || mv.upc || '';

    var taxClassId = (ctpProduct.taxCategory && ctpProduct.taxCategory.id)
        ? ctpProduct.taxCategory.id : '';

    // Collect all variants — masterVariant first (CTP's designated default)
    var variants = [];
    if (mv.sku) {
        variants.push({
            productId:  sanitizeId(mv.sku) || (masterId + '-v1'),
            sku:        mv.sku,
            isDefault:  true,
            images:     mv.images     || [],
            attributes: mv.attributes || []
        });
    }
    for (var i = 0; i < ctpVars.length; i++) {
        var v = ctpVars[i];
        if (v.sku) {
            variants.push({
                productId:  sanitizeId(v.sku),
                sku:        v.sku,
                isDefault:  false,
                images:     v.images     || [],
                attributes: v.attributes || []
            });
        }
    }
    // Guarantee exactly one default — fallback to first variant if masterVariant had no SKU
    var hasDefault = false;
    for (var di = 0; di < variants.length; di++) {
        if (variants[di].isDefault) { hasDefault = true; break; }
    }
    if (!hasDefault && variants.length > 0) {
        variants[0].isDefault = true;
    }

    // Category IDs from CTP references
    var categories = [];
    if (data.categories) {
        for (var ci = 0; ci < data.categories.length; ci++) {
            if (data.categories[ci].id) categories.push(data.categories[ci].id);
        }
    }
    // classification-category: use first category key (obj may have .key or only .id)
    var classificationCategory = '';
    if (data.categories && data.categories.length) {
        classificationCategory = data.categories[0].key || data.categories[0].id || '';
    }

    return {
        productId:        masterId,
        ctpId:            ctpProduct.id,
        ctpKey:           ctpKey,
        name:             name,
        shortDescription: shortDescription,
        longDescription:  longDescription,
        slug:             slug,
        metaTitle:        metaTitle,
        metaDescription:  metaDescription,
        metaKeywords:     metaKeywords,
        brand:            brand,
        manufacturerName: manufacturerName,
        manufacturerSku:  manufacturerSku,
        ean:              ean,
        upc:              upc,
        taxClassId:       taxClassId,
        masterImages:             mv.images || [],
        categories:               categories,
        classificationCategory:   classificationCategory,
        variants:                 variants,
        hasVariants:              variants.length > 0,
        productKind:              productKind,
        setProducts:              setProducts,
        bundleProducts:           bundleProducts
    };
}

module.exports = { transformProduct: transformProduct };
