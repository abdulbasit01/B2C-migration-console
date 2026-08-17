'use strict';

var systemFieldResolver = require('*/cartridge/scripts/migration/core/systemFieldResolver');

/**
 * Detect whether a CT product is a base/variant product, a product set, or a bundle.
 * CT doesn't have a native set/bundle type — detection is by:
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

    // Product type name takes priority for bundle/set classification
    if (ptName.indexOf('bundle') !== -1) return 'bundle';
    if (ptName.indexOf('set') !== -1)    return 'set';

    // Fallback: detect by masterVariant attribute values
    var mvAttrs = (data.masterVariant && data.masterVariant.attributes) || [];
    for (var i = 0; i < mvAttrs.length; i++) {
        var val = mvAttrs[i].value;
        if (val === null || val === undefined) continue;

        // Single Reference<Product>: { typeId: "product", id: "..." } — set
        if (!Array.isArray(val) && typeof val === 'object' && val.typeId === 'product' && val.id) {
            return 'set';
        }

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

    return 'base';
}

/**
 * Extract member product IDs for a product set from CT master-variant attributes.
 * Returns [{productId: string}]
 */
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractSetProducts(data) {
    var mvAttrs = (data.masterVariant && data.masterVariant.attributes) || [];
    for (var i = 0; i < mvAttrs.length; i++) {
        var val = mvAttrs[i].value;
        if (val === null || val === undefined) continue;

        var members = [];

        if (typeof val === 'string') {
            // Plain UUID string — attribute defined as text type storing a product UUID
            if (UUID_RE.test(val.trim())) {
                members.push({ productId: val.trim() });
            }
        } else if (!Array.isArray(val) && typeof val === 'object') {
            if (val.typeId === 'product' && val.id) {
                // Reference<Product>: { typeId: "product", id: "..." }
                members.push({ productId: val.id });
            } else {
                // Localized text attribute storing a UUID: { "en": "9bcb6490-...", ... }
                var keys = Object.keys(val);
                for (var li = 0; li < keys.length; li++) {
                    var locVal = val[keys[li]];
                    if (typeof locVal === 'string' && UUID_RE.test(locVal.trim())) {
                        members.push({ productId: locVal.trim() });
                        break;
                    }
                }
            }
        } else if (Array.isArray(val) && val.length) {
            var first = val[0];
            if (first && typeof first === 'object') {
                if (first.typeId === 'product' && first.id) {
                    // [{ typeId: "product", id: "..." }, ...]
                    for (var j = 0; j < val.length; j++) {
                        if (val[j] && val[j].typeId === 'product' && val[j].id) {
                            members.push({ productId: val[j].id });
                        }
                    }
                } else if (first.value && first.value.typeId === 'product' && first.value.id) {
                    // [{ value: { typeId: "product", id: "..." } }, ...]
                    for (var k = 0; k < val.length; k++) {
                        if (val[k] && val[k].value && val[k].value.id) {
                            members.push({ productId: val[k].value.id });
                        }
                    }
                }
            } else if (first && typeof first === 'string' && UUID_RE.test(first.trim())) {
                // Array of plain UUID strings
                for (var si = 0; si < val.length; si++) {
                    if (typeof val[si] === 'string' && UUID_RE.test(val[si].trim())) {
                        members.push({ productId: val[si].trim() });
                    }
                }
            }
        }

        if (members.length) return members;
    }
    return [];
}

/**
 * Extract bundled component product IDs + quantities from CT master-variant attributes.
 * Returns [{productId: string, quantity: number}]
 */
function extractBundleProducts(data) {
    var mvAttrs = (data.masterVariant && data.masterVariant.attributes) || [];
    for (var i = 0; i < mvAttrs.length; i++) {
        var val = mvAttrs[i].value;
        if (!Array.isArray(val) || !val.length) continue;
        var first = val[0];
        if (!first) continue;

        var components = [];

        if (Array.isArray(first)) {
            // Set<Nested(bundle-item)>: [[{name:"bundled-product",value:{...}},{name:"quantity",value:N}],...]
            for (var ni = 0; ni < val.length; ni++) {
                var nestedItem = val[ni];
                if (!Array.isArray(nestedItem)) continue;
                var productId = null;
                var quantity  = 1;
                for (var nj = 0; nj < nestedItem.length; nj++) {
                    var attr = nestedItem[nj];
                    if (!attr || !attr.name) continue;
                    if (attr.name === 'bundled-product' && attr.value && attr.value.id) {
                        productId = attr.value.id;
                    } else if (attr.name === 'quantity' && attr.value != null) {
                        quantity = Number(attr.value) || 1;
                    }
                }
                if (productId) components.push({ productId: productId, quantity: quantity });
            }
        } else if (typeof first === 'object') {
            if (first.product && first.product.typeId === 'product' && first.quantity != null) {
                // [{ product: { typeId:"product", id:"..." }, quantity: N }, ...]
                for (var j = 0; j < val.length; j++) {
                    var item = val[j];
                    if (item && item.product && item.product.id) {
                        components.push({ productId: item.product.id, quantity: Number(item.quantity) || 1 });
                    }
                }
            } else if (first.typeId === 'product' && first.id) {
                // [{ typeId:"product", id:"..." }, ...] — plain refs, no quantity
                for (var k = 0; k < val.length; k++) {
                    if (val[k] && val[k].typeId === 'product' && val[k].id) {
                        components.push({ productId: val[k].id, quantity: 1 });
                    }
                }
            }
        }

        if (components.length) return components;
    }
    return [];
}

function getLocalized(obj) {
    if (!obj || typeof obj === 'string') return obj ? String(obj) : '';
    if (typeof obj !== 'object') return '';
    return obj['en'] || obj['en-US'] || obj['en-GB'] || obj['en-AU']
        || (Object.keys(obj).length > 0 ? obj[Object.keys(obj)[0]] : '') || '';
}

/**
 * True when value looks like a CT LocalizedString map (locale → string),
 * not an enum/reference object.
 * @param {*} val
 * @returns {boolean}
 */
function isPlainLocaleMap(val) {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
    if (val.key !== undefined || val.typeId !== undefined || val.id !== undefined) return false;
    var keys = Object.keys(val);
    if (!keys.length) return false;
    var i;
    for (i = 0; i < keys.length; i++) {
        var v = val[keys[i]];
        if (v !== null && typeof v === 'object') return false;
    }
    return true;
}

/**
 * Normalize a CT localized value to { locale: string }.
 * @param {*} val
 * @returns {Object.<string, string>}
 */
function toLocaleMap(val) {
    if (val == null || val === '') return {};
    if (typeof val === 'string' || typeof val === 'number') {
        return { 'x-default': String(val) };
    }
    if (!isPlainLocaleMap(val)) return {};
    var out = {};
    var keys = Object.keys(val);
    var i;
    for (i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (val[k] == null || val[k] === '') continue;
        out[k] = String(val[k]);
    }
    return out;
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
 * Normalize attr names for matching: product_description ≡ product-description.
 * Check Attributes may use underscores; CT API often keeps hyphens.
 * @param {string} name
 * @returns {string}
 */
function normalizeAttrNameKey(name) {
    return String(name || '').toLowerCase().replace(/[-_]+/g, '_');
}

/**
 * Raw attribute value from a CT attributes array (no locale collapse).
 * @param {Array} attributes
 * @param {string} attrName
 * @returns {*}
 */
function getAttrRawValue(attributes, attrName) {
    if (!attributes || !attributes.length || !attrName) return null;
    var want = normalizeAttrNameKey(attrName);
    var i;
    for (i = 0; i < attributes.length; i++) {
        var an = attributes[i] && attributes[i].name != null
            ? String(attributes[i].name) : '';
        if (normalizeAttrNameKey(an) !== want) continue;
        return attributes[i].value;
    }
    return null;
}

/**
 * Extract a named attribute value from a CT attributes array.
 * Handles plain values and localized values { "en": "..." }.
 * Name match is case-insensitive and hyphen/underscore-insensitive.
 */
function getAttrValue(attributes, attrName) {
    var val = getAttrRawValue(attributes, attrName);
    if (val === null || val === undefined) return '';
    if (typeof val === 'object' && !Array.isArray(val)) {
        if (val.key !== undefined && val.label !== undefined && !isPlainLocaleMap(val)) {
            if (typeof val.label === 'object') return getLocalized(val.label) || String(val.key);
            return String(val.label || val.key);
        }
        return getLocalized(val) || '';
    }
    return String(val);
}

/**
 * Locale map for a named attribute (ltext → all locales).
 * @param {Array} attributes
 * @param {string} attrName
 * @returns {Object.<string, string>}
 */
function getAttrLocaleMap(attributes, attrName) {
    var val = getAttrRawValue(attributes, attrName);
    if (val === null || val === undefined) return {};
    if (typeof val === 'object' && !Array.isArray(val) && val.key !== undefined && !isPlainLocaleMap(val)) {
        if (typeof val.label === 'object') return toLocaleMap(val.label);
        return toLocaleMap(val.key != null ? String(val.key) : '');
    }
    return toLocaleMap(val);
}

/**
 * Find attribute across product-level + masterVariant + all variants (current only).
 * @param {Object} ctpProduct
 * @param {Object} data
 * @param {Object} mv
 * @param {string} attrName
 * @returns {string}
 */
function findProductAttrValue(ctpProduct, data, mv, attrName) {
    var map = findProductAttrLocaleMap(ctpProduct, data, mv, attrName);
    return getLocalized(map) || '';
}

/**
 * Full locale map for an attribute on masterData.current only (never staged).
 * @returns {Object.<string, string>}
 */
function findProductAttrLocaleMap(ctpProduct, data, mv, attrName) {
    var map = getAttrLocaleMap((mv && mv.attributes) || [], attrName);
    if (Object.keys(map).length) return map;
    map = getAttrLocaleMap((data && data.attributes) || [], attrName);
    if (Object.keys(map).length) return map;
    var vars = (data && data.variants) || [];
    var i;
    for (i = 0; i < vars.length; i++) {
        map = getAttrLocaleMap((vars[i] && vars[i].attributes) || [], attrName);
        if (Object.keys(map).length) return map;
    }
    return {};
}

/**
 * Build a source-key → value function for curated CT Product aliases + attrs.
 * @param {Object} ctpProduct
 * @param {Object} data - masterData.current
 * @param {Object} mv - masterVariant
 * @returns {function(string): string}
 */
function makeCtpSourceGetter(ctpProduct, data, mv) {
    return function getSourceValue(sourceKey) {
        if (!sourceKey) return '';
        switch (sourceKey) {
            case 'id':
                return ctpProduct.id ? String(ctpProduct.id) : '';
            case 'key':
                return ctpProduct.key ? String(ctpProduct.key) : '';
            case 'name':
                return getLocalized(data.name) || '';
            case 'description':
                return getLocalized(data.description) || '';
            case 'slug':
                return getLocalized(data.slug) || '';
            case 'metaTitle':
                return getLocalized(data.metaTitle) || '';
            case 'metaDescription':
                return getLocalized(data.metaDescription) || '';
            case 'metaKeywords':
                return getLocalized(data.metaKeywords) || '';
            case 'sku':
                return (mv && mv.sku) ? String(mv.sku) : '';
            case 'taxCategory':
                return (ctpProduct.taxCategory && ctpProduct.taxCategory.id)
                    ? String(ctpProduct.taxCategory.id) : '';
            case 'masterData.published':
                if (ctpProduct.masterData && ctpProduct.masterData.published != null) {
                    return String(ctpProduct.masterData.published);
                }
                return '';
            case 'createdAt':
                return ctpProduct.createdAt ? String(ctpProduct.createdAt) : '';
            case 'lastModifiedAt':
                return ctpProduct.lastModifiedAt ? String(ctpProduct.lastModifiedAt) : '';
            case 'images':
                return '';
            default:
                return findProductAttrValue(ctpProduct, data, mv, sourceKey);
        }
    };
}

/**
 * Build a source-key → locale-map function for localized CT fields / attrs.
 * @returns {function(string): Object.<string, string>}
 */
function makeCtpLocaleGetter(ctpProduct, data, mv) {
    return function getSourceLocales(sourceKey) {
        if (!sourceKey) return {};
        switch (sourceKey) {
            case 'name':
                return toLocaleMap(data.name);
            case 'description':
                return toLocaleMap(data.description);
            case 'slug':
                return toLocaleMap(data.slug);
            case 'metaTitle':
                return toLocaleMap(data.metaTitle);
            case 'metaDescription':
                return toLocaleMap(data.metaDescription);
            case 'metaKeywords':
                return toLocaleMap(data.metaKeywords);
            case 'id':
            case 'key':
            case 'sku':
            case 'taxCategory':
            case 'masterData.published':
            case 'createdAt':
            case 'lastModifiedAt':
            case 'images':
                return {};
            default:
                return findProductAttrLocaleMap(ctpProduct, data, mv, sourceKey);
        }
    };
}

/**
 * Resolve one SFCC Product system field via schema mapping + session maps.
 * @param {string} sfccField
 * @param {function(string): string} getSourceValue
 * @returns {string}
 */
function resolveProductSystemField(sfccField, getSourceValue) {
    return systemFieldResolver.resolve({
        platformId:     'ct',
        task:           'Product',
        sfccField:      sfccField,
        moduleKey:      'product',
        getSourceValue: getSourceValue
    });
}

/**
 * Resolve all locales for a localizable SFCC Product system field.
 * @param {string} sfccField
 * @param {function(string): Object.<string, string>} getSourceLocales
 * @returns {Object.<string, string>}
 */
function resolveProductSystemFieldLocales(sfccField, getSourceLocales) {
    var keys = systemFieldResolver.getSourceKeys('ct', 'Product', sfccField, 'product');
    var i;
    for (i = 0; i < keys.length; i++) {
        var map = getSourceLocales(keys[i]) || {};
        if (Object.keys(map).length) return map;
    }
    return {};
}

/**
 * SFCC catalog product-id from schema map id → ID (never prefers key).
 * Empty mapped id falls back to CT + uuid-without-dashes only.
 * @param {Object} ctpProduct
 * @returns {string}
 */
/**
 * CT category reference → SFCC category-id.
 * Prefers expanded Category.key (catalog XML uses key || id).
 * @param {Object} ref - { id, key?, obj? }
 * @returns {string}
 */
function ctCategoryRefToSfccId(ref) {
    if (!ref) return '';
    if (ref.obj && ref.obj.key) return String(ref.obj.key);
    if (ref.key) return String(ref.key);
    return ref.id ? String(ref.id) : '';
}

function resolveMasterProductId(ctpProduct) {
    ctpProduct = ctpProduct || {};
    var rawGet = makeCtpSourceGetter(ctpProduct, {}, {});
    // Never let session/AI map of key → ID replace catalog product-id (id → ID).
    var getSourceValue = function (sourceKey) {
        if (sourceKey === 'key') return '';
        return rawGet(sourceKey);
    };
    var mapped = resolveProductSystemField('ID', getSourceValue);
    if (mapped) {
        var sanitized = sanitizeId(mapped);
        return sanitized || String(mapped);
    }
    if (ctpProduct.id) {
        return 'CT' + String(ctpProduct.id).replace(/-/g, '');
    }
    return '';
}

function transformProduct(ctpProduct) {
    var md  = ctpProduct.masterData || {};
    // Always use published current projection — never staged drafts
    var data = md.current || {};

    var productKind    = detectProductKind(ctpProduct, data);
    var setProducts    = [];
    var bundleProducts = [];
    if (productKind === 'set') {
        setProducts = extractSetProducts(data);
    } else if (productKind === 'bundle') {
        bundleProducts = extractBundleProducts(data);
    }

    var mv      = data.masterVariant || {};
    var ctpVars = data.variants || [];
    var getSourceValue = makeCtpSourceGetter(ctpProduct, data, mv);
    var getSourceLocales = makeCtpLocaleGetter(ctpProduct, data, mv);

    var ctpKey = ctpProduct.key || '';
    // Schema map id → ID → catalog product-id attribute (do not prefer key)
    var masterId = resolveMasterProductId(ctpProduct);

    // Localizable system fields: keep full locale maps for XML (all CT locales)
    var nameLocales = resolveProductSystemFieldLocales('name', getSourceLocales);
    var shortDescriptionLocales = resolveProductSystemFieldLocales('shortDescription', getSourceLocales);
    var longDescriptionLocales = resolveProductSystemFieldLocales('longDescription', getSourceLocales);
    var slugLocales = resolveProductSystemFieldLocales('pageURL', getSourceLocales);
    var metaTitleLocales = resolveProductSystemFieldLocales('pageTitle', getSourceLocales);
    var metaDescriptionLocales = resolveProductSystemFieldLocales('pageDescription', getSourceLocales);
    var metaKeywordsLocales = resolveProductSystemFieldLocales('pageKeywords', getSourceLocales);

    var name = getLocalized(nameLocales) || resolveProductSystemField('name', getSourceValue);
    var shortDescription = getLocalized(shortDescriptionLocales)
        || resolveProductSystemField('shortDescription', getSourceValue);
    var longDescription = getLocalized(longDescriptionLocales)
        || resolveProductSystemField('longDescription', getSourceValue);
    var slug = getLocalized(slugLocales) || resolveProductSystemField('pageURL', getSourceValue);
    var metaTitle = getLocalized(metaTitleLocales) || resolveProductSystemField('pageTitle', getSourceValue);
    var metaDescription = getLocalized(metaDescriptionLocales)
        || resolveProductSystemField('pageDescription', getSourceValue);
    var metaKeywords = getLocalized(metaKeywordsLocales)
        || resolveProductSystemField('pageKeywords', getSourceValue);
    var brand = resolveProductSystemField('brand', getSourceValue);
    var manufacturerName = resolveProductSystemField('manufacturerName', getSourceValue);
    var manufacturerSku = resolveProductSystemField('manufacturerSKU', getSourceValue);
    var ean = resolveProductSystemField('EAN', getSourceValue);
    var upc = resolveProductSystemField('UPC', getSourceValue);
    var taxClassId = resolveProductSystemField('taxClassID', getSourceValue);
    var onlineFlagRaw = resolveProductSystemField('onlineFlag', getSourceValue);
    var onlineFlag = onlineFlagRaw === ''
        ? true
        : !(onlineFlagRaw === 'false' || onlineFlagRaw === '0');
    // Quantity system fields — only when schema/session-mapped (never invent defaults)
    var minOrderQuantity = resolveProductSystemField('minOrderQuantity', getSourceValue);
    var stepQuantity = resolveProductSystemField('stepQuantity', getSourceValue);
    var unitQuantity = resolveProductSystemField('unitQuantity', getSourceValue);
    var unit = resolveProductSystemField('unit', getSourceValue);
    var unitMeasure = resolveProductSystemField('unitMeasure', getSourceValue);

    // Collect CT variants as separate SFCC products.
    // Master product-id = schema id → ID. Variant product-id = {masterId}-{n} (1-based).
    // masterVariant is always n=1 (default); additional variants are 2, 3, …
    var variants = [];
    var variantSeq = 0;

    function pushCtpVariant(ctpVariant, isDefault) {
        if (!ctpVariant) return;
        variantSeq += 1;
        variants.push({
            productId:  masterId ? (String(masterId) + '-' + variantSeq) : ('variant-' + variantSeq),
            sku:        ctpVariant.sku || '',
            isDefault:  !!isDefault,
            images:     ctpVariant.images || [],
            attributes: ctpVariant.attributes || [],
            prices:     ctpVariant.prices || []
        });
    }

    // Always emit masterVariant as -1 when present (even without sku)
    if (mv && (mv.sku || (mv.attributes && mv.attributes.length) || ctpVars.length
            || mv.id != null || Object.keys(mv).length)) {
        pushCtpVariant(mv, true);
    }
    var i;
    for (i = 0; i < ctpVars.length; i++) {
        pushCtpVariant(ctpVars[i], false);
    }
    // Guarantee exactly one default
    var hasDefault = false;
    for (var di = 0; di < variants.length; di++) {
        if (variants[di].isDefault) { hasDefault = true; break; }
    }
    if (!hasDefault && variants.length > 0) {
        variants[0].isDefault = true;
    }

    // Category IDs: prefer expanded Category.key (same as catalog XML category-id)
    var categories = [];
    if (data.categories) {
        for (var ci = 0; ci < data.categories.length; ci++) {
            var catId = ctCategoryRefToSfccId(data.categories[ci]);
            if (catId) categories.push(catId);
        }
    }
    var classificationCategory = categories.length ? categories[0] : '';

    return {
        productId:        masterId,
        ctpId:            ctpProduct.id,
        ctpKey:           ctpKey,
        name:             name,
        shortDescription: shortDescription,
        longDescription:  longDescription,
        // Full locale maps for catalog XML (string fields above remain for default/compat)
        nameLocales:             nameLocales,
        shortDescriptionLocales: shortDescriptionLocales,
        longDescriptionLocales:  longDescriptionLocales,
        slugLocales:             slugLocales,
        metaTitleLocales:        metaTitleLocales,
        metaDescriptionLocales:  metaDescriptionLocales,
        metaKeywordsLocales:     metaKeywordsLocales,
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
        onlineFlag:       onlineFlag,
        minOrderQuantity: minOrderQuantity,
        stepQuantity:     stepQuantity,
        unitQuantity:     unitQuantity,
        unit:             unit,
        unitMeasure:      unitMeasure,
        masterImages:             mv.images || [],
        // Master-owned CT attributes (SameForAll / product-level) for master <custom-attributes>
        masterAttributes:         mv.attributes || [],
        categories:               categories,
        classificationCategory:   classificationCategory,
        variants:                 variants,
        hasVariants:              variants.length > 0,
        productKind:              productKind,
        setProducts:              setProducts,
        bundleProducts:           bundleProducts
    };
}

module.exports = {
    transformProduct:       transformProduct,
    resolveMasterProductId: resolveMasterProductId,
    sanitizeId:             sanitizeId,
    toLocaleMap:            toLocaleMap,
    isPlainLocaleMap:       isPlainLocaleMap,
    ctCategoryRefToSfccId:  ctCategoryRefToSfccId
};
