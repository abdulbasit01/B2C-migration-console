'use strict';

var http        = require('*/cartridge/scripts/migration/core/http');
var cfg         = require('*/cartridge/scripts/migration/configAccessor');
var Encoding    = require('dw/crypto/Encoding');
var Bytes       = require('dw/util/Bytes');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');
var sourceAttrIds = require('*/cartridge/scripts/migration/core/sourceAttrIds');
var runner      = require('*/cartridge/scripts/migration/core/attrPreflightRunner');

var SFCC_OBJECT_TYPE = 'Store';

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
        throw new Error('CTP auth failed (' + res.status + ')');
    }
    return res.data.access_token;
}

function getCtpStoreFields() {
    var c   = cfg.ctp;
    var tok = getCtpToken();
    var qs  = '?where=' + encodeURIComponent('resourceTypeIds contains any ("store")') + '&limit=500';

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/types' + qs,
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CTP Types API failed (' + res.status + ')');
    }

    var fields = [];
    var types  = (res.data && res.data.results) ? res.data.results : [];
    var t;

    for (t = 0; t < types.length; t++) {
        var fieldDefs = types[t].fieldDefinitions || [];
        var f;
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

function getStoreTraceAttrs(platformId) {
    var shopify = platformId === 'shopify';
    return [
        { sfccId: 'countryCodeValue', label: 'Country Code Value', sourceType: 'String' },
        { sfccId: 'inventoryListId',  label: 'Inventory List ID',  sourceType: 'String' },
        sourceAttrIds.traceAttr('StoreId', shopify ? 'Shopify Location ID' : 'CTP Store ID', 'String', platformId),
        sourceAttrIds.traceAttr('StoreKey', shopify ? 'Shopify Location Key' : 'CTP Store Key', 'String', platformId),
        sourceAttrIds.traceAttr('ChannelId', shopify ? 'Shopify Location ID' : 'CTP Channel ID', 'String', platformId),
        sourceAttrIds.traceAttr('ChannelKey', shopify ? 'Shopify Location Key' : 'CTP Channel Key', 'String', platformId)
    ];
}

function checkMissingAttributes() {
    return runner.checkMissing(SFCC_OBJECT_TYPE, getCtpStoreFields, getStoreTraceAttrs);
}

function createAttributes(attrs) {
    return runner.createAttributes(SFCC_OBJECT_TYPE, attrs);
}

module.exports = {
    checkMissingAttributes: checkMissingAttributes,
    createAttributes:       createAttributes
};
