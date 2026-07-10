'use strict';

var http           = require('*/cartridge/scripts/migration/core/http');
var cfg            = require('*/cartridge/scripts/migration/configAccessor');
var shopifyApi     = require('*/cartridge/scripts/migration/core/shopifyApi');
var sourceAttrIds  = require('*/cartridge/scripts/migration/core/sourceAttrIds');

var SFCC_OWNER_TYPES = {
    Order:                  ['ORDER'],
    ProductInventoryRecord: [],
    Store:                  ['LOCATION'],
    PriceBook:              ['PRODUCT', 'VARIANT'],
    ShippingMethod:         [],
    TaxClass:               []
};

function fetchMetafieldDefs(ownerType) {
    var creds = cfg.shopify;
    shopifyApi.getCreds(creds);
    var url   = shopifyApi.adminBase(creds) + '/graphql.json';
    var query = '{ metafieldDefinitions(ownerType: ' + ownerType + ', first: 250) { nodes { name key namespace type { name } } } }';
    var res   = http.post(url, shopifyApi.authHeaders(creds), JSON.stringify({ query: query }));
    if (res.status !== 200 || !res.data || !res.data.data) {
        return [];
    }
    var mfDefs = res.data.data.metafieldDefinitions;
    return (mfDefs && mfDefs.nodes) ? mfDefs.nodes : [];
}

/**
 * @param {string} sfccObjectType
 * @returns {Array<{ sfccId: string, label: string, sourceType: string }>}
 */
function fieldsForSfccObject(sfccObjectType) {
    var ownerTypes = SFCC_OWNER_TYPES[sfccObjectType] || [];
    var fields     = [];
    var seen       = {};
    var oi;
    var mi;
    var def;
    var rawId;
    var sfccId;

    for (oi = 0; oi < ownerTypes.length; oi++) {
        var defs = fetchMetafieldDefs(ownerTypes[oi]);
        for (mi = 0; mi < defs.length; mi++) {
            def    = defs[mi];
            rawId  = def.namespace ? def.namespace + '__' + def.key : def.key;
            sfccId = sourceAttrIds.toAttrId(rawId, 'shopify');
            if (seen[sfccId]) continue;
            seen[sfccId] = true;
            fields.push({
                sfccId:     sfccId,
                label:      def.name || def.key,
                sourceType: def.type && def.type.name ? def.type.name : 'single_line_text_field'
            });
        }
    }
    return fields;
}

module.exports = {
    fieldsForSfccObject: fieldsForSfccObject
};
