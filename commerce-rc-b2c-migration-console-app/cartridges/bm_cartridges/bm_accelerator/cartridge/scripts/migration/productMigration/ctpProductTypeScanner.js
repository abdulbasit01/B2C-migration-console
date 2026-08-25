'use strict';

var http     = require('*/cartridge/scripts/migration/core/http');
var cfg      = require('*/cartridge/scripts/migration/configAccessor');
var Encoding = require('dw/crypto/Encoding');
var Bytes    = require('dw/util/Bytes');

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function getToken() {
    var c    = cfg.ctp;
    var body = 'grant_type=client_credentials';
    if (c.scopes) body += '&scope=' + encodeURIComponent(c.scopes);
    var res = http.post(
        c.authUrl + '/oauth/token',
        {
            Authorization:  'Basic ' + toBase64(c.clientId + ':' + c.clientSecret),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    );
    if (res.status !== 200 || !res.data.access_token) {
        throw new Error('CT auth failed (' + res.status + ')');
    }
    return res.data.access_token;
}

/** True when the attribute type is an array of product references: Set<Reference<Product>> */
function isProductRefSet(attrType) {
    return attrType
        && attrType.name === 'Set'
        && attrType.elementType
        && attrType.elementType.name === 'reference'
        && attrType.elementType.referenceTypeId === 'product';
}

/** True when the attribute type is a plain product reference: Reference<Product> */
function isProductRef(attrType) {
    return attrType
        && attrType.name === 'reference'
        && attrType.referenceTypeId === 'product';
}

/** True when the attribute type holds a quantity-like numeric value */
function isQuantityAttr(ad) {
    if (!ad || !ad.type) return false;
    var t    = ad.type.name || '';
    var name = (ad.name || '').toLowerCase();
    return (t === 'Integer' || t === 'Long' || t === 'Double' || t === 'Number')
        && (name.indexOf('qty') !== -1 || name.indexOf('quantity') !== -1 || name.indexOf('amount') !== -1);
}

/**
 * Fetch products for one product type from CT.
 * Returns { count, products: [{ ctpId, ctpKey, sfccId }] }
 */
function fetchProductsByType(tok, typeId) {
    var c   = cfg.ctp;
    var url = c.apiUrl + '/' + c.projectKey + '/products'
        + '?where=' + encodeURIComponent('productType(id="' + typeId + '")')
        + '&limit=500&withTotal=true';
    var res = http.get(url, { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' });
    if (res.status !== 200 || !res.data) return { count: 0, products: [] };
    var results = res.data.results || [];
    var products = [];
    for (var i = 0; i < results.length; i++) {
        var p     = results[i];
        var ctpId = p.id || '';
        var ctpKey = (p.masterData && p.masterData.current && p.masterData.current.masterVariant && p.masterData.current.masterVariant.sku)
            ? p.masterData.current.masterVariant.sku
            : (p.key || '');
        var sfccId = ctpKey ? ctpKey : ('CT' + ctpId.replace(/-/g, ''));
        products.push({ ctpId: ctpId, ctpKey: p.key || '', sfccId: sfccId });
    }
    return { count: res.data.total || results.length, products: products };
}

/**
 * Fetch all CT product types and classify each as 'set', 'bundle', or 'base'.
 *
 * Detection logic (in priority order):
 *  1. Type name contains "bundle"  → bundle
 *  2. Type has product-ref-set attr AND a quantity attr → bundle
 *  3. Type name contains "set"     → set
 *  4. Type has a product-ref-set attr (no quantity attr) → set
 *  5. Everything else              → base (ignored here)
 *
 * Returns { token, sets: [...], bundles: [...] }
 */
function scanProductTypes() {
    var c   = cfg.ctp;
    var tok = getToken();

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/product-types?limit=500',
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT /product-types failed (' + res.status + ')');
    }

    var types   = (res.data && res.data.results) ? res.data.results : [];
    var sets    = [];
    var bundles = [];

    for (var t = 0; t < types.length; t++) {
        var pt     = types[t];
        var ptName = (pt.name || '').toLowerCase();
        var attrs  = pt.attributes || [];

        var refSetAttrName  = null;
        var qtyAttrName     = null;

        for (var a = 0; a < attrs.length; a++) {
            var ad = attrs[a];
            if (isProductRefSet(ad.type) || isProductRef(ad.type)) {
                refSetAttrName = ad.name;
            }
            if (isQuantityAttr(ad)) {
                qtyAttrName = ad.name;
            }
        }

        var isBundle = ptName.indexOf('bundle') !== -1
            || (refSetAttrName && qtyAttrName);
        var isSet    = !isBundle && (ptName.indexOf('set') !== -1 || refSetAttrName);

        if (isBundle) {
            bundles.push({
                typeId:          pt.id,
                typeName:        pt.name,
                refAttrName:     refSetAttrName,
                quantityAttrName: qtyAttrName
            });
        } else if (isSet) {
            sets.push({
                typeId:      pt.id,
                typeName:    pt.name,
                refAttrName: refSetAttrName
            });
        }
    }

    return { token: tok, sets: sets, bundles: bundles };
}

/**
 * Returns summary of all CT product types that produce Product Sets,
 * with a product count for each type.
 * @returns {Array} [{ typeId, typeName, refAttrName, count }]
 */
function getProductSetsSummary() {
    var scan   = scanProductTypes();
    var result = [];
    for (var i = 0; i < scan.sets.length; i++) {
        var s    = scan.sets[i];
        var data = fetchProductsByType(scan.token, s.typeId);
        result.push({
            typeId:      s.typeId,
            typeName:    s.typeName,
            refAttrName: s.refAttrName || '—',
            count:       data.count,
            products:    data.products
        });
    }
    return result;
}

/**
 * Returns summary of all CT product types that produce Bundle Products,
 * with a product count for each type.
 * @returns {Array} [{ typeId, typeName, refAttrName, quantityAttrName, count }]
 */
function getBundleProductsSummary() {
    var scan   = scanProductTypes();
    var result = [];
    for (var i = 0; i < scan.bundles.length; i++) {
        var b    = scan.bundles[i];
        var data = fetchProductsByType(scan.token, b.typeId);
        result.push({
            typeId:           b.typeId,
            typeName:         b.typeName,
            refAttrName:      b.refAttrName      || '—',
            quantityAttrName: b.quantityAttrName  || '—',
            count:            data.count,
            products:         data.products
        });
    }
    return result;
}

module.exports = {
    getProductSetsSummary:    getProductSetsSummary,
    getBundleProductsSummary: getBundleProductsSummary
};
