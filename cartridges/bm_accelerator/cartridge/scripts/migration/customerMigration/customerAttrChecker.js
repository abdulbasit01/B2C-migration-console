'use strict';

var http        = require('*/cartridge/scripts/migration/core/http');
var cfg         = require('*/cartridge/scripts/migration/configAccessor');
var Encoding    = require('dw/crypto/Encoding');
var Bytes       = require('dw/util/Bytes');
var typeMap     = require('*/cartridge/scripts/migration/connectors/ctp/ctpTypeMap');
var sfccClient  = require('*/cartridge/scripts/migration/sfccClient');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');

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
 * Fetch all custom field definitions for the 'customer' resource type from CTP Types API.
 * @returns {Array} [{ name, label, ctpType }]
 */
function getCtpCustomerFields() {
    var c   = cfg.ctp;
    var tok = getCtpToken();
    var qs  = '?where=' + encodeURIComponent('resourceTypeIds contains any ("customer")') + '&limit=500';

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/types' + qs,
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CTP Types API failed (' + res.status + ')');
    }

    var fields = [];
    var types  = (res.data && res.data.results) ? res.data.results : [];

    for (var t = 0; t < types.length; t++) {
        var fieldDefs = types[t].fieldDefinitions || [];
        for (var f = 0; f < fieldDefs.length; f++) {
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
 * Compare CTP customer custom fields against SFCC Customer attribute definitions.
 * Returns fields present in CTP but missing in SFCC.
 * @returns {Array} [{ id, label, ctpType, sfccType }]
 */
function checkMissingAttributes() {
    var ctpFields = getCtpCustomerFields();
    if (!ctpFields.length) return [];

    var sfccToken   = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(sfccToken, 'Customer');

    var missing = [];
    var seen    = {};

    for (var i = 0; i < ctpFields.length; i++) {
        var field = ctpFields[i];
        var id    = field.name;
        if (seen[id]) continue;
        seen[id] = true;
        if (!existingIds[id]) {
            missing.push({
                id:       id,
                label:    field.label,
                ctpType:  field.ctpType,
                sfccType: typeMap.resolveCustomFieldType(field.ctpType)
            });
        }
    }
    return missing;
}

/**
 * Create the given attribute definitions on the SFCC Customer system object.
 * @param {Array} attrs - [{ id, label, sfccType }]
 * @returns {{ created: number, failed: number, errors: Array }}
 */
function createAttributes(attrs) {
    var sfccToken = sfccClient.getSFCCToken();
    var created   = 0;
    var failed    = 0;
    var errors    = [];

    for (var i = 0; i < attrs.length; i++) {
        var attr = attrs[i];
        try {
            var def = attrBuilder.buildAttrDefinition(
                attr.id,
                attr.sfccType || 'string',
                attr.label    || attr.id
            );
            sfccClient.createAttributeDefinition(sfccToken, 'Customer', def);
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
