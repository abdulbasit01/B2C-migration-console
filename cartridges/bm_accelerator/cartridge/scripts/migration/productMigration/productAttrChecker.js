'use strict';

var http        = require('*/cartridge/scripts/migration/core/http');
var cfg         = require('*/cartridge/scripts/migration/configAccessor');
var Encoding    = require('dw/crypto/Encoding');
var Bytes       = require('dw/util/Bytes');
var typeMap     = require('*/cartridge/scripts/migration/connectors/ctp/ctpTypeMap');
var sfccClient  = require('*/cartridge/scripts/migration/sfccClient');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');
var nativeMap   = require('*/cartridge/scripts/migration/config/nativeFieldMap');

var CTP_ATTR_GROUP_ID   = 'CTPMigration';
var CTP_ATTR_GROUP_NAME = 'CTP Migration';

// Fixed tracking attributes always required for product migration.
// These capture CTP identifiers on the SFCC Product system object.
var CTP_BUILTIN_FIELDS = [
    { name: 'ctp_product_id',  sfccId: 'ctp_product_id',  label: 'CTP Product ID',  ctpType: 'String' },
    { name: 'ctp_product_key', sfccId: 'ctp_product_key', label: 'CTP Product Key', ctpType: 'String' }
];

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function getCtpToken() {
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
        throw new Error('CTP auth failed (' + res.status + ')');
    }
    return res.data.access_token;
}

/**
 * Fetch all attribute definitions from all CTP product types.
 * CTP product attributes live under /product-types, not /types.
 * @returns {Array} [{ name, label, ctpType }]
 */
function getCtpProductTypeFields() {
    var c   = cfg.ctp;
    var tok = getCtpToken();

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/product-types?limit=500',
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CTP Product Types API failed (' + res.status + ')');
    }

    var fields = [];
    var seen   = {};
    var types  = (res.data && res.data.results) ? res.data.results : [];

    for (var t = 0; t < types.length; t++) {
        var attrDefs = types[t].attributes || [];
        for (var a = 0; a < attrDefs.length; a++) {
            var ad = attrDefs[a];
            if (seen[ad.name]) continue;
            seen[ad.name] = true;

            // Check if this attr is handled by a native SFCC field (skip rule)
            var rule = nativeMap.getRule('commercetools', 'Product', ad.name);
            if (rule && rule.action === 'skip') continue;

            // For custom_attr mapped fields, use the mapped sfccField as the SFCC attr ID
            var sfccId = (rule && rule.action === 'custom_attr') ? rule.sfccField
                : ('ctp_' + String(ad.name).replace(/[^a-zA-Z0-9_]/g, '_'));

            var ctpTypeName = (ad.type && ad.type.name) ? ad.type.name : 'text';

            fields.push({
                name:    ad.name,
                sfccId:  sfccId,
                label:   attrBuilder.toLabel(ad.label) || ad.name,
                ctpType: ctpTypeName
            });
        }
    }
    return fields;
}

/**
 * Compare CTP product type attributes against SFCC Product attribute definitions.
 * Includes static built-in tracking attrs (ctp_product_id, ctp_product_key)
 * plus all dynamic CTP product type attributes, mapped to their SFCC attr IDs.
 * Returns attrs present in CTP but missing in SFCC.
 * @returns {Array} [{ id, label, ctpType, sfccType }]
 */
function checkMissingAttributes() {
    var sfccToken   = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(sfccToken, 'Product');

    try { sfccClient.ensureAttributeGroup(sfccToken, 'Product', CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME); } catch (ge) {}

    var missing = [];
    var seen    = {};

    // 1. Static built-in tracking attrs always needed for product migration
    for (var j = 0; j < CTP_BUILTIN_FIELDS.length; j++) {
        var bf = CTP_BUILTIN_FIELDS[j];
        if (seen[bf.sfccId]) continue;
        seen[bf.sfccId] = true;
        if (!existingIds[bf.sfccId]) {
            missing.push({ id: bf.sfccId, label: bf.label, ctpType: bf.ctpType, sfccType: 'string' });
        } else {
            try { sfccClient.addAttributeToGroup(sfccToken, 'Product', CTP_ATTR_GROUP_ID, bf.sfccId); } catch (age) {}
        }
    }

    // 2. Dynamic CTP product type attributes (mapped to ctp_* SFCC attrs via nativeFieldMap)
    var ctpFields = getCtpProductTypeFields();
    for (var i = 0; i < ctpFields.length; i++) {
        var field = ctpFields[i];
        var id    = field.sfccId;
        if (seen[id]) continue;
        seen[id] = true;
        if (!existingIds[id]) {
            missing.push({
                id:       id,
                label:    field.label,
                ctpType:  field.ctpType,
                sfccType: typeMap.resolveProductType(field.ctpType)
            });
        } else {
            try { sfccClient.addAttributeToGroup(sfccToken, 'Product', CTP_ATTR_GROUP_ID, id); } catch (age) {}
        }
    }

    return missing;
}

/**
 * Create the given attribute definitions on the SFCC Product system object
 * and assign each to the "CTP Migration" attribute group.
 * @param {Array} attrs - [{ id, label, sfccType }]
 * @returns {{ created: number, failed: number, errors: Array }}
 */
function createAttributes(attrs) {
    var sfccToken = sfccClient.getSFCCToken();
    var created   = 0;
    var failed    = 0;
    var errors    = [];

    try {
        sfccClient.ensureAttributeGroup(sfccToken, 'Product', CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME);
    } catch (ge) {}

    for (var i = 0; i < attrs.length; i++) {
        var attr = attrs[i];
        try {
            var def = attrBuilder.buildAttrDefinition(
                attr.id,
                attr.sfccType || 'string',
                attr.label    || attr.id
            );
            sfccClient.createAttributeDefinition(sfccToken, 'Product', def);
            sfccClient.addAttributeToGroup(sfccToken, 'Product', CTP_ATTR_GROUP_ID, attr.id);
            created++;
        } catch (e) {
            failed++;
            if (errors.length < 5) errors.push(attr.id + ': ' + (e.message || String(e)));
        }
    }
    return { created: created, failed: failed, errors: errors };
}

module.exports = {
    checkMissingAttributes: checkMissingAttributes,
    createAttributes:       createAttributes
};
