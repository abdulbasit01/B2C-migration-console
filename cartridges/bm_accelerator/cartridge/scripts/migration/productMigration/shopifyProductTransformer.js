'use strict';

function xmlSafeId(str) {
    if (!str) return '';
    return String(str)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 100);
}

function extractNumericId(gid) {
    if (!gid) return '';
    var parts = String(gid).split('/');
    return parts[parts.length - 1];
}

/**
 * Transform a Shopify GraphQL product node into the same shape that
 * productXmlBuilder.buildProductXml() expects.
 * productKind is always 'base' — Shopify sets/bundles are not natively
 * representable without custom metafield conventions (v2 feature).
 *
 * @param {Object} shopifyProduct - GraphQL product node
 * @returns {Object} transformed product
 */
function transformProduct(shopifyProduct) {
    var p       = shopifyProduct;
    var handle  = p.handle || ('shopify-' + extractNumericId(p.id));
    var masterId = xmlSafeId(handle) || ('shopify-' + extractNumericId(p.id));

    // Variants
    var variantNodes = (p.variants && p.variants.nodes) || [];
    var variants     = [];
    for (var vi = 0; vi < variantNodes.length; vi++) {
        var v      = variantNodes[vi];
        var varSku = v.sku || '';
        var varId  = varSku ? xmlSafeId(varSku) : (masterId + '-v' + (vi + 1));

        var varAttrs = [];
        var opts     = v.selectedOptions || [];
        for (var oi = 0; oi < opts.length; oi++) {
            varAttrs.push({ name: opts[oi].name, value: opts[oi].value });
        }
        if (v.price)          varAttrs.push({ name: 'price',          value: String(v.price) });
        if (v.compareAtPrice) varAttrs.push({ name: 'compareAtPrice', value: String(v.compareAtPrice) });
        if (v.barcode)        varAttrs.push({ name: 'barcode',        value: String(v.barcode) });

        var varImgs = [];
        if (v.image && v.image.url) varImgs.push({ url: v.image.url });

        variants.push({
            productId:  varId,
            sku:        varSku,
            isDefault:  vi === 0,
            images:     varImgs,
            attributes: varAttrs
        });
    }

    // Product-level images
    var imageNodes   = (p.images && p.images.nodes) || [];
    var masterImages = [];
    for (var ii = 0; ii < imageNodes.length; ii++) {
        if (imageNodes[ii].url) masterImages.push({ url: imageNodes[ii].url });
    }
    if (!masterImages.length && variantNodes.length && variantNodes[0].image && variantNodes[0].image.url) {
        masterImages.push({ url: variantNodes[0].image.url });
    }

    // Collections → SFCC categories
    var collNodes  = (p.collections && p.collections.nodes) || [];
    var categories = [];
    var classificationCategory = '';
    for (var ci = 0; ci < collNodes.length; ci++) {
        if (collNodes[ci].handle) {
            categories.push(collNodes[ci].handle);
            if (!classificationCategory) classificationCategory = collNodes[ci].handle;
        }
    }

    var tags     = (p.tags && p.tags.length) ? p.tags.join(', ') : '';
    var firstVar = variantNodes[0] || {};

    // Bundle detection via productType or tags (works without Shopify Bundles app)
    var pType    = String(p.productType || '').toLowerCase();
    var pTags    = (p.tags || []).join(' ').toLowerCase();
    var isBundle = (pType.indexOf('bundle') !== -1) || (pTags.indexOf('bundle') !== -1);

    // Bundle components via metafields (namespace: bundle, key: components — JSON array of handles)
    var bundleProducts = [];
    if (isBundle) {
        var mfNodes = (p.metafields && p.metafields.nodes) || [];
        for (var mi = 0; mi < mfNodes.length; mi++) {
            var mf = mfNodes[mi];
            if (mf.namespace === 'bundle' && mf.key === 'components') {
                try {
                    var components = JSON.parse(mf.value || '[]');
                    for (var ci = 0; ci < components.length; ci++) {
                        var comp = components[ci];
                        if (comp.handle) {
                            bundleProducts.push({
                                productId: xmlSafeId(comp.handle),
                                quantity:  comp.quantity || 1
                            });
                        }
                    }
                } catch (e) { /* malformed metafield — skip */ }
                break;
            }
        }
    }

    return {
        productId:              masterId,
        shopifyId:              extractNumericId(p.id || ''),
        shopifyGid:             p.id     || '',
        shopifyStatus:          p.status || '',
        shopifyProductType:     p.productType || '',
        name:                   p.title       || '',
        shortDescription:       '',
        longDescription:        p.bodyHtml    || '',
        slug:                   handle,
        metaTitle:              (p.seo && p.seo.title)       || p.title || '',
        metaDescription:        (p.seo && p.seo.description) || '',
        metaKeywords:           tags,
        brand:                  p.vendor || '',
        manufacturerName:       p.vendor || '',
        manufacturerSku:        firstVar.sku     || '',
        ean:                    '',
        upc:                    firstVar.barcode || '',
        taxClassId:             '',
        masterImages:           masterImages,
        categories:             categories,
        classificationCategory: classificationCategory,
        variants:               isBundle ? [] : variants,
        hasVariants:            !isBundle && variants.length > 0,
        productKind:            isBundle ? 'bundle' : 'base',
        setProducts:            [],
        bundleProducts:         bundleProducts
    };
}

module.exports = { transformProduct: transformProduct };
