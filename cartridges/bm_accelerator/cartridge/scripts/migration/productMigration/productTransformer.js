'use strict';

/**
 * Get first available locale value from a CTP localized string.
 * @param {Object} obj - CTP localized string { "en": "...", "de": "..." }
 * @returns {string}
 */
function getLocalized(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return obj['en'] || obj['en-US'] || obj['en-GB']
        || (Object.keys(obj).length > 0 ? obj[Object.keys(obj)[0]] : '') || '';
}

/**
 * Sanitize a string to be a valid SFCC product ID.
 * Replaces any character that is not alphanumeric, hyphen, or underscore.
 * @param {string} str
 * @returns {string}
 */
function sanitizeId(str) {
    if (!str) return '';
    return String(str)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 100);
}

/**
 * Transform a raw CTP product object into an SFCC-ready product descriptor.
 *
 * @param {Object} ctpProduct - raw CTP product from /products endpoint
 * @returns {{
 *   productId:   string,
 *   ctpId:       string,
 *   ctpKey:      string,
 *   name:        string,
 *   description: string,
 *   categories:  string[],
 *   variants:    Array<{ productId, sku, isDefault, images, attributes }>,
 *   hasVariants: boolean
 * }}
 */
function transformProduct(ctpProduct) {
    var current = (ctpProduct.masterData && ctpProduct.masterData.current) || {};
    var mv      = current.masterVariant || {};
    var ctpVars = current.variants || [];

    var ctpKey  = ctpProduct.key || '';
    var masterId = ctpKey
        ? sanitizeId(ctpKey)
        : ('CTP' + String(ctpProduct.id).replace(/-/g, ''));

    // Collect all variants: masterVariant first, then the rest
    var variants = [];
    if (mv.sku) {
        variants.push({
            productId:  sanitizeId(mv.sku) || (masterId + '-v1'),
            sku:        mv.sku,
            isDefault:  true,
            images:     mv.images     || [],
            attributes: mv.attributes || [],
            prices:     mv.prices     || []
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
                attributes: v.attributes || [],
                prices:     v.prices     || []
            });
        }
    }

    // Category IDs (CTP category references carry only the UUID — the job step
    // or BM import will resolve them against the imported category tree)
    var categories = [];
    if (current.categories) {
        for (var ci = 0; ci < current.categories.length; ci++) {
            if (current.categories[ci].id) {
                categories.push(current.categories[ci].id);
            }
        }
    }

    return {
        productId:   masterId,
        ctpId:       ctpProduct.id,
        ctpKey:      ctpKey,
        name:        getLocalized(current.name),
        description: getLocalized(current.description) || getLocalized(current.metaDescription) || '',
        slug:        getLocalized(current.slug) || '',
        categories:  categories,
        variants:    variants,
        hasVariants: variants.length > 0
    };
}

module.exports = { transformProduct: transformProduct };
