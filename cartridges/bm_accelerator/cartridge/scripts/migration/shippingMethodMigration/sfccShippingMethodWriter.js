'use strict';

var sfccClient = require('*/cartridge/scripts/migration/sfccClient');

/**
 * Create or update one shipping method on an SFCC site via OCAPI Data API.
 * @param {string} token
 * @param {string} siteId
 * @param {Object} method - from shippingMethodTransformer
 * @returns {{ ok: boolean, skipped: boolean, error: string|null }}
 */
function createShippingMethod(token, siteId, method) {
    if (!siteId) return { ok: false, skipped: false, error: 'siteId is required' };
    if (!method || !method.method_id) return { ok: false, skipped: false, error: 'method_id is required' };

    var tok = token || sfccClient.getSFCCToken();
    var s   = sfccClient.getSFCCSettings();
    var url = s.baseUrl + '/s/-/dw/data/' + s.metaVersion
        + '/sites/' + encodeURIComponent(siteId)
        + '/shipping_methods/' + encodeURIComponent(method.method_id)
        + '?client_id=' + encodeURIComponent(s.bmClientId);

    var payload = {
        id:           method.method_id,
        name:         { default: method.display_name || method.method_id },
        description:  { default: method.description || '' },
        enabled:      method.online_flag !== false,
        tax_class_id: method.tax_class_id || 'standard',
        price:        method.price || 0
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

    var HTTPClient = require('dw/net/HTTPClient');
    var client     = new HTTPClient();
    client.setTimeout(30000);
    client.open('PUT', url);
    client.setRequestHeader('Authorization', 'Bearer ' + tok);
    client.setRequestHeader('Content-Type', 'application/json');
    client.send(JSON.stringify(payload));

    var status = client.getStatusCode();
    if (status >= 200 && status < 300) {
        return { ok: true, skipped: false, error: null };
    }

    var text = client.getText() || '';
    var textLc = text.toLowerCase();
    if (status === 409 || textLc.indexOf('exist') >= 0 || textLc.indexOf('duplicate') >= 0) {
        return { ok: false, skipped: true, error: null };
    }

    return { ok: false, skipped: false, error: 'OCAPI PUT failed (' + status + '): ' + text };
}

module.exports = { createShippingMethod: createShippingMethod };
