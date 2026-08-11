'use strict';

var http        = require('*/cartridge/scripts/migration/core/http');
var cfg         = require('*/cartridge/scripts/migration/configAccessor');
var Encoding    = require('dw/crypto/Encoding');
var Bytes       = require('dw/util/Bytes');
var attrBuilder = require('*/cartridge/scripts/migration/core/attrBuilder');
var nativeMap   = require('*/cartridge/scripts/migration/config/nativeFieldMap');
var runner      = require('*/cartridge/scripts/migration/core/attrPreflightRunner');

var CTP_ATTR_GROUP_ID   = 'CTPMigration';
var CTP_ATTR_GROUP_NAME = 'CT Migration';

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
        throw new Error('CT auth failed (' + res.status + ')');
    }
    return res.data.access_token;
}

/**
 * SFCC attribute id for a CT product-type field — keep the source name as-is
 * (including hyphens). Check Attributes UX, AI maps, and create-metadata all use this.
 * @param {string} name
 * @returns {string}
 */
function toCustomSfccId(name) {
    return String(name || '').trim();
}

/**
 * Fetch all attribute definitions from all CT product types.
 * Rules: not aliased / not identity / not skipped → create candidate with source name as id.
 * @returns {Array} [{ name, label, ctpType, sfccId, sourceKey }]
 */
function getCtpProductTypeFields() {
    var c   = cfg.ctp;
    var tok = getCtpToken();

    var res = http.get(
        c.apiUrl + '/' + c.projectKey + '/product-types?limit=500',
        { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('CT Product Types API failed (' + res.status + ')');
    }

    var fields = [];
    var seen   = {};
    var types  = (res.data && res.data.results) ? res.data.results : [];

    for (var t = 0; t < types.length; t++) {
        var attrDefs = types[t].attributes || [];
        for (var a = 0; a < attrDefs.length; a++) {
            var ad = attrDefs[a];
            if (!ad || !ad.name || seen[ad.name]) continue;
            seen[ad.name] = true;

            // Aliased / identity / explicit-skip handled in classifyFields; still pass
            // the field so mapped/skipped sections stay accurate when names collide.
            fields.push({
                name:      ad.name,
                sourceKey: ad.name,
                sfccId:    toCustomSfccId(ad.name),
                label:     attrBuilder.toLabel(ad.label) || ad.name,
                ctpType:   (ad.type && ad.type.name) ? ad.type.name : 'text'
            });
        }
    }
    return fields;
}

/**
 * Build check table:
 *   1. curated CT Product aliases (mapped)
 *   2. CT Product Type attributes (create if not alias/identity/exists)
 * Skipped catalog + coverage pending come from classifyFields.
 * @returns {{ mapped: Array, missing: Array, coveragePending: Array, skipped: Array }}
 */
function checkMissingAttributes() {
    var fields = nativeMap.getMappedSourceFields('commercetools', 'Product');
    var i;
    try {
        var ctpFields = getCtpProductTypeFields();
        for (i = 0; i < ctpFields.length; i++) {
            fields.push(ctpFields[i]);
        }
    } catch (e) {
        // Types API failure still allows curated maps
    }

    return runner.classifyFields({
        sfccObjectType: 'Product',
        taskName:       'Product',
        moduleKey:      'product',
        fields:         fields
    });
}

function createAttributes(attrs) {
    return runner.createDefinitions('Product', CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME, attrs);
}

module.exports = {
    getCtpProductTypeFields: getCtpProductTypeFields,
    checkMissingAttributes:  checkMissingAttributes,
    createAttributes:        createAttributes
};
