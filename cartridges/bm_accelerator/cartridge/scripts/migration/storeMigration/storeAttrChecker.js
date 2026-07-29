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
    var base = [
        { sfccId: 'countryCodeValue', label: 'Country Code Value', sourceType: 'String' },
        { sfccId: 'inventoryListId',  label: 'Inventory List ID',  sourceType: 'String' }
    ];

    if (platformId === 'sap') {
        // SAP's PointOfService has only one natural identifier (name) — no separate
        // UUID-vs-key or store-vs-channel distinction like CTP/Shopify, so a single
        // trace attribute covers it instead of 4 redundant, identical-valued ones.
        return base.concat([
            sourceAttrIds.traceAttr('StoreCode', 'SAP Store Code', 'String', platformId)
        ]);
    }

    var storeIdLabel;
    var storeKeyLabel;
    var channelIdLabel;
    var channelKeyLabel;

    if (platformId === 'shopify') {
        storeIdLabel    = 'Shopify Location ID';
        channelIdLabel  = 'Shopify Location ID';
        storeKeyLabel   = 'Shopify Location Key';
        channelKeyLabel = 'Shopify Location Key';
    } else {
        storeIdLabel    = 'CTP Store ID';
        storeKeyLabel   = 'CTP Store Key';
        channelIdLabel  = 'CTP Channel ID';
        channelKeyLabel = 'CTP Channel Key';
    }

    return base.concat([
        sourceAttrIds.traceAttr('StoreId', storeIdLabel, 'String', platformId),
        sourceAttrIds.traceAttr('StoreKey', storeKeyLabel, 'String', platformId),
        sourceAttrIds.traceAttr('ChannelId', channelIdLabel, 'String', platformId),
        sourceAttrIds.traceAttr('ChannelKey', channelKeyLabel, 'String', platformId)
    ]);
}

function checkMissingAttributes() {
    var attrIdMapSession = require('*/cartridge/scripts/migration/core/attrIdMapSession');
    return runner.checkMissing(
        SFCC_OBJECT_TYPE,
        getCtpStoreFields,
        getStoreTraceAttrs,
        attrIdMapSession.read('store')
    );
}

function createAttributes(attrs) {
    return runner.createAttributes(SFCC_OBJECT_TYPE, attrs);
}

module.exports = {
    checkMissingAttributes: checkMissingAttributes,
    createAttributes:       createAttributes
};
