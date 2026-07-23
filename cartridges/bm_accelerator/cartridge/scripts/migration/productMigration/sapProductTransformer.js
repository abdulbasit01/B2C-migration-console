'use strict';

/**
 * Transform an SAP Commerce (OCC v2) product into the same shape that
 * productXmlBuilder.buildProductXml() expects (see shopifyProductTransformer.js for
 * the reference shape). productKind is always 'base' — bundle/set detection for
 * SAP is not yet implemented (Phase 1 scope is simple + variant products).
 *
 * NOTE: field paths below (variantOptions, classifications, categories) follow the
 * standard OCC ProductWsDTO shape but have not been verified against a live instance
 * yet — revisit once Data Wizard → Test Connection succeeds.
 *
 * @param {Object} sapProduct - OCC product detail (fields=FULL)
 * @returns {Object} transformed product
 */
function localized(val) {
    if (val === null || val === undefined) return '';
    return String(val);
}

function transformProduct(sapProduct) {
    var p    = sapProduct;
    var code = String(p.code || '');

    // Variants: OCC exposes sibling variants on the base product as variantOptions.
    var variantNodes = p.variantOptions || [];
    var variants     = [];

    for (var vi = 0; vi < variantNodes.length; vi++) {
        var v          = variantNodes[vi];
        var varCode    = String(v.code || (code + '-v' + (vi + 1)));
        var qualifiers = v.variantOptionQualifiers || [];

        var varAttrs = [];
        for (var qi = 0; qi < qualifiers.length; qi++) {
            var q = qualifiers[qi];
            if (q.qualifier) {
                varAttrs.push({ name: q.qualifier, value: q.value });
            }
        }

        variants.push({
            productId:  varCode,
            sku:        varCode,
            isDefault:  vi === 0,
            attributes: varAttrs
        });
    }

    // Categories: OCC returns categories[] with code/name on the FULL product detail.
    var catNodes   = p.categories || [];
    var categories = [];
    var classificationCategory = '';
    for (var ci = 0; ci < catNodes.length; ci++) {
        if (catNodes[ci].code) {
            categories.push(catNodes[ci].code);
            if (!classificationCategory) classificationCategory = catNodes[ci].code;
        }
    }

    return {
        productId:              code,
        sapId:                  code,
        sapApprovalStatus:      p.approvalStatus || '',
        name:                   localized(p.name),
        shortDescription:       localized(p.summary),
        longDescription:        localized(p.description),
        slug:                   code,
        metaTitle:              localized(p.name),
        metaDescription:        localized(p.summary),
        brand:                  p.manufacturer || '',
        manufacturerName:       p.manufacturer || '',
        manufacturerSku:        code,
        ean:                    p.ean || '',
        upc:                    '',
        taxClassId:             '',
        masterImages:           [],
        categories:             categories,
        classificationCategory: classificationCategory,
        variants:               variants,
        hasVariants:            variants.length > 0,
        productKind:            'base',
        setProducts:            [],
        bundleProducts:         []
    };
}

module.exports = { transformProduct: transformProduct };
