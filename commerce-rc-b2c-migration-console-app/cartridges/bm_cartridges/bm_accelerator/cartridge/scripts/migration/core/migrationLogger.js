'use strict';

/**
 * Named logger categories for B2C Migration Console (LINK logging standard).
 * Never log tokens, passwords, or full auth response bodies.
 */

var Logger = require('dw/system/Logger');

function get(category) {
    return Logger.getLogger('bm_accelerator', category || 'Migration');
}

module.exports = {
    get:      get,
    http:     get('ServiceHttp'),
    shopify:  get('Shopify'),
    ctp:      get('CT'),
    sfcc:     get('SFCC'),
    webdav:   get('WebDAV'),
    catalog:  get('Catalog'),
    customer: get('Customer'),
    order:    get('Order'),
    product:  get('Product'),
    security: get('Security'),
    ui:       get('UI')
};
