'use strict';

var sfccClient = require('*/cartridge/scripts/migration/sfccClient');

/**
 * PUT one currency variant of a shipping method to SFCC via OCAPI Data API.
 * @param {string} tok
 * @param {string} siteId
 * @param {Object} method
 * @param {string} methodId - already currency-suffixed if this method has multiple variants
 * @param {{price: number, currency: string}} variant
 * @returns {{ ok: boolean, skipped: boolean, error: string|null }}
 */
function putOneVariant(tok, siteId, method, methodId, variant) {
    var s   = sfccClient.getSFCCSettings();
    var url = s.baseUrl + '/s/-/dw/data/' + s.metaVersion
        + '/sites/' + encodeURIComponent(siteId)
        + '/shipping_methods/' + encodeURIComponent(methodId)
        + '?client_id=' + encodeURIComponent(s.bmClientId);

    var payload = {
        id:           methodId,
        name:         { default: method.display_name || methodId },
        description:  { default: method.description || '' },
        enabled:      method.online_flag !== false,
        tax_class_id: method.tax_class_id || 'standard',
        price:        variant.price || 0,
        currency:     variant.currency
    };

    var customKeys = Object.keys(method);
    for (var i = 0; i < customKeys.length; i++) {
        var k = customKeys[i];
        if (k.length > 2 && k.charAt(0) === 'c' && k.charAt(1) === '_') {
            var attrId = k.slice(2);
            var val    = method[k];
            if (val !== null && val !== undefined) {
                payload['c_' + attrId] = val;
            }
        }
    }

    var res = sfccClient.doPut(url, tok, payload);

    var status = res.status;
    if (status >= 200 && status < 300) {
        return { ok: true, skipped: false, error: null };
    }

    var text = res.text || '';
    var textLc = text.toLowerCase();
    if (status === 409 || textLc.indexOf('exist') >= 0 || textLc.indexOf('duplicate') >= 0) {
        return { ok: false, skipped: true, error: null };
    }

    return { ok: false, skipped: false, error: 'OCAPI PUT failed (' + status + '): ' + text };
}

/**
 * Create or update one shipping method on an SFCC site via OCAPI Data API.
 * SFCC ties one currency to one shipping-method record, so a CT method with rates in
 * multiple currencies is written as multiple SFCC methods — one PUT per currency, with
 * the method-id suffixed by currency only when there's more than one variant.
 * @param {string} token
 * @param {string} siteId
 * @param {Object} method - from shippingMethodTransformer
 * @returns {{ ok: boolean, skipped: boolean, error: string|null }}
 */
function createShippingMethod(token, siteId, method) {
    if (!siteId) return { ok: false, skipped: false, error: 'siteId is required' };
    if (!method || !method.method_id) return { ok: false, skipped: false, error: 'method_id is required' };

    var tok      = token || sfccClient.getSFCCToken();
    var variants = (method.priceVariants && method.priceVariants.length)
        ? method.priceVariants
        : [{ price: method.price, currency: method.currency }];

    var okCount = 0;
    var skipCount = 0;
    var errors = [];

    for (var v = 0; v < variants.length; v++) {
        var variant  = variants[v];
        var methodId = variants.length > 1
            ? (method.method_id + '-' + variant.currency)
            : method.method_id;
        var result = putOneVariant(tok, siteId, method, methodId, variant);
        if (result.ok) {
            okCount++;
        } else if (result.skipped) {
            skipCount++;
        } else {
            errors.push(methodId + ': ' + result.error);
        }
    }

    if (errors.length) {
        return { ok: false, skipped: false, error: errors.join('; ') };
    }
    if (okCount === 0 && skipCount > 0) {
        return { ok: false, skipped: true, error: null };
    }
    return { ok: true, skipped: false, error: null };
}

module.exports = { createShippingMethod: createShippingMethod };
