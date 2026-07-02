'use strict';

var http        = require('*/cartridge/scripts/migration/core/http');
var cfg         = require('*/cartridge/scripts/migration/configAccessor');
var Encoding    = require('dw/crypto/Encoding');
var Bytes       = require('dw/util/Bytes');
var typeMap     = require('*/cartridge/scripts/migration/connectors/ctp/ctpTypeMap');
var sfccClient  = require('*/cartridge/scripts/migration/sfccClient');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');

var CTP_ATTR_GROUP_ID   = 'CTPMigration';
var CTP_ATTR_GROUP_NAME = 'CTP Migration';
var SFCC_OBJECT_TYPE    = 'Store';

// Standard store fields (name, address, geo, flags) map to native SFCC store XML.
var MIGRATION_ATTRS = [
    { name: 'countryCodeValue', label: 'Country Code Value', ctpType: 'String' },
    { name: 'inventoryListId',  label: 'Inventory List ID',  ctpType: 'String' },
    { name: 'ctpStoreId',       label: 'CTP Store ID',       ctpType: 'String' },
    { name: 'ctpStoreKey',      label: 'CTP Store Key',      ctpType: 'String' },
    { name: 'ctpChannelId',     label: 'CTP Channel ID',     ctpType: 'String' },
    { name: 'ctpChannelKey',    label: 'CTP Channel Key',    ctpType: 'String' }
];

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

/**
 * Fetch custom field definitions for store resource type from CTP Types API.
 * @returns {Array}
 */
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

function collectRequiredFields() {
    var fields = [];
    var i;

    for (i = 0; i < MIGRATION_ATTRS.length; i++) {
        fields.push(MIGRATION_ATTRS[i]);
    }

    var ctpFields = getCtpStoreFields();
    for (i = 0; i < ctpFields.length; i++) {
        fields.push(ctpFields[i]);
    }
    return fields;
}

/**
 * Compare CTP store fields and migration attrs against SFCC Store attribute definitions.
 * @returns {Array}
 */
function checkMissingAttributes() {
    var sfccToken   = sfccClient.getSFCCToken();
    var existingIds = sfccClient.getExistingAttributeIds(sfccToken, SFCC_OBJECT_TYPE);

    try {
        sfccClient.ensureAttributeGroup(sfccToken, SFCC_OBJECT_TYPE, CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME);
    } catch (ge) {}

    var missing = [];
    var seen    = {};
    var required = collectRequiredFields();
    var i;

    for (i = 0; i < required.length; i++) {
        var field = required[i];
        var id    = field.name;
        if (seen[id]) continue;
        seen[id] = true;
        if (!existingIds[id]) {
            missing.push(typeMap.enrichMissingAttribute({
                id:      field.name,
                label:   field.label,
                ctpType: field.ctpType
            }));
        } else {
            try { sfccClient.addAttributeToGroup(sfccToken, SFCC_OBJECT_TYPE, CTP_ATTR_GROUP_ID, id); } catch (age) {}
        }
    }

    return missing;
}

/**
 * Create attribute definitions on SFCC Store system object.
 * @param {Array} attrs
 * @returns {{ created: number, failed: number, errors: Array }}
 */
function createAttributes(attrs) {
    var sfccToken = sfccClient.getSFCCToken();
    var created   = 0;
    var failed    = 0;
    var errors    = [];

    try {
        sfccClient.ensureAttributeGroup(sfccToken, SFCC_OBJECT_TYPE, CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME);
    } catch (ge) {}

    var i;
    for (i = 0; i < attrs.length; i++) {
        var attr = attrs[i];
        try {
            var def = attrBuilder.buildAttrDefinition(
                attr.id,
                attr.sfccType || 'string',
                attr.label    || attr.id
            );
            sfccClient.createAttributeDefinition(sfccToken, SFCC_OBJECT_TYPE, def);
            sfccClient.addAttributeToGroup(sfccToken, SFCC_OBJECT_TYPE, CTP_ATTR_GROUP_ID, attr.id);
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
