'use strict';

var http        = require('*/cartridge/scripts/migration/core/http');
var cfg         = require('*/cartridge/scripts/migration/configAccessor');
var Encoding    = require('dw/crypto/Encoding');
var Bytes       = require('dw/util/Bytes');
var typeMap     = require('*/cartridge/scripts/migration/connectors/ctp/ctpTypeMap');
var sfccClient  = require('*/cartridge/scripts/migration/sfccClient');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');
var nativeFieldMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');

// CTP built-in customer fields that have no standard SFCC equivalent.
// Each entry maps the CTP field name to the SFCC custom attribute ID we create/populate.
var CTP_BUILTIN_FIELDS = [
    { name: 'vatId',      sfccId: 'ctp_vat_id',      label: 'VAT ID',      ctpType: 'String' },
    { name: 'locale',     sfccId: 'ctp_locale',      label: 'Locale',      ctpType: 'String' },
    { name: 'middleName', sfccId: 'ctp_middle_name', label: 'Middle Name', ctpType: 'String' }
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
 * Compare CTP customer fields against SFCC Customer attribute definitions.
 * Checks both CTP custom type fields (dynamic, from the Types API) and a
 * predefined list of CTP built-in fields (vatId, locale, middleName) that have
 * no standard SFCC equivalent and therefore require custom attribute definitions.
 * Returns fields present in CTP but missing in SFCC.
 * @returns {Array} [{ id, label, ctpType, sfccType }]
 */
function checkMissingAttributes() {
    // Customer profile custom attributes live on the 'Profile' system object, not 'Customer'.
    var sfccToken    = sfccClient.getSFCCToken();
    var profileAttrs = sfccClient.getAttributeDefinitions(sfccToken, 'Profile');
    var customerAttrs = sfccClient.getAttributeDefinitions(sfccToken, 'Customer');
    var sysAttrs     = profileAttrs.concat(customerAttrs); // Customer + Profile — customer-related native fields span both
    var existingIds  = {};
    for (var pa = 0; pa < profileAttrs.length; pa++) existingIds[profileAttrs[pa].id] = true;

    // Ensure the attribute group exists on every check so attrs can be linked below.
    try { sfccClient.ensureAttributeGroup(sfccToken, 'Profile', CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME); } catch (ge) {}

    var missing = [];
    var seen    = {};

    /**
     * Attach native-field metadata to an entry, unless there's a confident (action:"skip")
     * SFCC system-field equivalent — in that case the field needs no custom attribute at all,
     * so the caller should not add it to the missing list.
     * @returns {Object|null} entry with metadata attached, or null when it should be skipped entirely
     */
    function withNativeHint(entry, sourceId, sourceLabel) {
        var rule = nativeFieldMap.getEffectiveRule('commercetools', 'Customer', sourceId, sourceLabel, sysAttrs);
        if (rule && rule.action === 'skip') return null;
        if (rule) {
            entry.sfccNativeField  = rule.sfccField;
            entry.sfccNativeNote   = rule.note;
            entry.sfccNativeAction = rule.action;
        }
        return entry;
    }

    // 1. CTP custom type fields (dynamic — defined in CTP via the Types API)
    var ctpFields = getCtpCustomerFields();
    for (var i = 0; i < ctpFields.length; i++) {
        var field = ctpFields[i];
        var id    = field.name;
        if (seen[id]) continue;
        seen[id] = true;
        if (!existingIds[id]) {
            var ctpEntry = withNativeHint(typeMap.enrichMissingAttribute({
                id:    field.name,
                label: field.label,
                ctpType: field.ctpType
            }), field.name, field.label);
            if (ctpEntry) missing.push(ctpEntry);
        } else {
            // Attr exists but may not be in the group yet (e.g. created before group logic was added).
            try { sfccClient.addAttributeToGroup(sfccToken, 'Profile', CTP_ATTR_GROUP_ID, id); } catch (age) {}
        }
    }

    // 2. CTP built-in fields — not in the Types API, checked against a static list.
    for (var j = 0; j < CTP_BUILTIN_FIELDS.length; j++) {
        var bf = CTP_BUILTIN_FIELDS[j];
        if (seen[bf.sfccId]) continue;
        seen[bf.sfccId] = true;
        if (!existingIds[bf.sfccId]) {
            var bfEntry = withNativeHint(typeMap.enrichMissingAttribute({
                id: bf.sfccId, label: bf.label, ctpType: bf.ctpType, sfccType: 'string'
            }), bf.sfccId, bf.label);
            if (bfEntry) missing.push(bfEntry);
        } else {
            // Attr exists but may not be in the group yet.
            try { sfccClient.addAttributeToGroup(sfccToken, 'Profile', CTP_ATTR_GROUP_ID, bf.sfccId); } catch (age) {}
        }
    }

    return missing;
}

var CTP_ATTR_GROUP_ID   = 'CTPMigration';
var CTP_ATTR_GROUP_NAME = 'CTP Migration';

/**
 * Create the given attribute definitions on the SFCC Profile system object
 * and assign each one to the "CTP Migration" attribute group so they appear
 * in BM's customer detail page.
 * @param {Array} attrs - [{ id, label, sfccType }]
 * @returns {{ created: number, failed: number, errors: Array }}
 */
function createAttributes(attrs) {
    var sfccToken = sfccClient.getSFCCToken();
    var created   = 0;
    var failed    = 0;
    var errors    = [];

    // Ensure the attribute group exists once before creating any attrs
    try {
        sfccClient.ensureAttributeGroup(sfccToken, 'Profile', CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME);
    } catch (ge) { /* non-fatal — attrs can still be created without a group */ }

    for (var i = 0; i < attrs.length; i++) {
        var attr = attrs[i];
        try {
            var def = attrBuilder.buildAttrDefinition(
                attr.id,
                attr.sfccType || 'string',
                attr.label    || attr.id
            );
            sfccClient.createAttributeDefinition(sfccToken, 'Profile', def);
            sfccClient.addAttributeToGroup(sfccToken, 'Profile', CTP_ATTR_GROUP_ID, attr.id);
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
