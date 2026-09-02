'use strict';

var http        = require('*/cartridge/scripts/migration/core/http');
var cfg         = require('*/cartridge/scripts/migration/configAccessor');
var Encoding    = require('dw/crypto/Encoding');
var Bytes       = require('dw/util/Bytes');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');
var runner      = require('*/cartridge/scripts/migration/core/attrPreflightRunner');

var SFCC_OBJECT_TYPE = 'Order';

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function getCtpToken() {
    var c    = cfg.ctp;
    var body = 'grant_type=client_credentials';
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

function getCtpOrderFields() {
    var c   = cfg.ctp;
    var tok = getCtpToken();
    var qs  = '?where=' + encodeURIComponent('resourceTypeIds contains any ("order")') + '&limit=500';

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/types' + qs,
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT Types API failed (' + res.status + ')');
    }

    var fields = [];
    var types  = (res.data && res.data.results) ? res.data.results : [];
    var t;
    var f;

    for (t = 0; t < types.length; t++) {
        var fieldDefs = types[t].fieldDefinitions || [];
        for (f = 0; f < fieldDefs.length; f++) {
            var fd = fieldDefs[f];
            fields.push({
                name:    fd.name,
                label:   attrBuilder.toLabel(fd.label) || fd.name,
                ctpType: fd.type && fd.type.name ? fd.type.name : 'String'
            });
        }
    }
    return fields;
}

/**
 * Fixed trace fields needed by source-specific order writers.
 * Shopify is written in full so the resulting SFCC attribute IDs are unambiguous.
 * @param {string} platformId - Active source platform.
 * @returns {Object[]} Source-specific trace fields.
 */
function getTraceFields(platformId) {
    if (platformId !== 'shopify') return [];
    return [
        { sfccId: 'shopifyOrderId', label: 'Shopify Order ID', sourceType: 'String' },
        { sfccId: 'shopifyOrderGid', label: 'Shopify Order GraphQL ID', sourceType: 'String' },
        { sfccId: 'shopifyCheckoutId', label: 'Shopify Checkout ID', sourceType: 'String' },
        { sfccId: 'shopifyClosedAt', label: 'Shopify Closed At', sourceType: 'DateTime' },
        { sfccId: 'shopifyCancelledAt', label: 'Shopify Cancelled At', sourceType: 'DateTime' },
        { sfccId: 'shopifyProcessedAt', label: 'Shopify Processed At', sourceType: 'DateTime' },
        { sfccId: 'shopifyTestOrder', label: 'Shopify Test Order', sourceType: 'Boolean' },
        { sfccId: 'shopifyTags', label: 'Shopify Order Tags', sourceType: 'String' },
        { sfccId: 'shopifyNoteAttributes', label: 'Shopify Note Attributes', sourceType: 'String' }
    ];
}

function checkMissingAttributes() {
    var attrIdMapSession = require('*/cartridge/scripts/migration/core/attrIdMapSession');
    return runner.checkMissing(
        SFCC_OBJECT_TYPE,
        getCtpOrderFields,
        getTraceFields,
        attrIdMapSession.read('order'),
        'order',
        'Order'
    );
}

function createAttributes(attrs) {
    return runner.createAttributes(SFCC_OBJECT_TYPE, attrs);
}

module.exports = {
    checkMissingAttributes: checkMissingAttributes,
    createAttributes:       createAttributes,
    getTraceFields:         getTraceFields
};
