'use strict';

function xmlSafeId(str) {
    if (!str) return '';
    return String(str)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 100);
}

/**
 * Transform a BigCommerce V3 catalog product (with variants/images/custom_fields)
 * into the shape that productXmlBuilder.buildProductXml() expects.
 *
 * @param {Object} bcProduct
 * @returns {Object} transformed product
 */
function transformProduct(bcProduct) {
    var p        = bcProduct;
    var productId = String(p.id || '');
    var slug      = p.sku ? xmlSafeId(p.sku) : ('bc-' + productId);

    var variantNodes = p.variants || [];

    // Single-variant / no real options → simple product
    var isSingleVariant = variantNodes.length <= 1;
    if (variantNodes.length === 1) {
        var opts0 = variantNodes[0].option_values || [];
        isSingleVariant = !opts0.length;
    }

    var masterId = productId || xmlSafeId(slug);

    var variants = [];
    if (!isSingleVariant) {
        for (var vi = 0; vi < variantNodes.length; vi++) {
            var v      = variantNodes[vi];
            var varSku = v.sku || '';
            var varId  = v.id != null ? String(v.id) : (masterId + '-v' + (vi + 1));

            var varAttrs = [];
            var opts     = v.option_values || [];
            for (var oi = 0; oi < opts.length; oi++) {
                var optName = opts[oi].option_display_name || opts[oi].option_id || 'option';
                var optVal  = opts[oi].label != null ? opts[oi].label : opts[oi].id;
                varAttrs.push({ name: String(optName), value: String(optVal) });
            }
            if (v.price != null)      varAttrs.push({ name: 'price',      value: String(v.price) });
            if (v.sale_price != null) varAttrs.push({ name: 'sale_price', value: String(v.sale_price) });
            if (v.upc)                varAttrs.push({ name: 'upc',        value: String(v.upc) });

            variants.push({
                productId:  varId,
                sku:        varSku,
                isDefault:  vi === 0,
                images:     [],
                attributes: varAttrs
            });
        }
    }

    var imageNodes   = p.images || [];
    var masterImages = [];
    for (var ii = 0; ii < imageNodes.length; ii++) {
        var url = imageNodes[ii].url_standard || imageNodes[ii].url_zoom || imageNodes[ii].url_thumbnail;
        if (url) masterImages.push({ url: url });
    }

    var catNodes   = p.categories || [];
    var categories = [];
    var classificationCategory = '';
    for (var ci = 0; ci < catNodes.length; ci++) {
        var catId = String(catNodes[ci]);
        if (catId) {
            categories.push(catId);
            if (!classificationCategory) classificationCategory = catId;
        }
    }

    var firstVar = variantNodes[0] || {};
    var status   = p.is_visible === false ? 'hidden' : 'visible';

    return {
        productId:              masterId,
        bcId:                   productId,
        bcSku:                  p.sku || '',
        bcStatus:               status,
        bcProductType:          p.type || '',
        name:                   p.name || '',
        shortDescription:       '',
        longDescription:        p.description || '',
        slug:                   slug,
        metaTitle:              (p.meta_title || p.name || ''),
        metaDescription:        p.meta_description || '',
        metaKeywords:           p.meta_keywords || '',
        brand:                  '',
        manufacturerName:       '',
        manufacturerSku:        p.sku || firstVar.sku || '',
        ean:                    '',
        upc:                    (firstVar.upc || p.upc || ''),
        taxClassId:             '',
        masterImages:           masterImages,
        categories:             categories,
        classificationCategory: classificationCategory,
        variants:               variants,
        hasVariants:            variants.length > 0,
        productKind:            'base',
        setProducts:            [],
        bundleProducts:         [],
        customFields:           p.custom_fields || []
    };
}

module.exports = { transformProduct: transformProduct };
