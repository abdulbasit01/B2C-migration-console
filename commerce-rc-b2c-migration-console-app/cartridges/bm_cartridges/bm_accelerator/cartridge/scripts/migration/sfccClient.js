'use strict';

/* global request */

var serviceHttp = require('*/cartridge/scripts/migration/core/serviceHttp');
var Encoding    = require('dw/crypto/Encoding');
var Bytes       = require('dw/util/Bytes');
var cfg         = require('*/cartridge/scripts/migration/configAccessor');
var creds       = require('*/cartridge/scripts/migration/sfccCredentialsAccessor');

/**
 * Build runtime SFCC settings — baseUrl from live request, credentials from prefs/files.
 * @returns {Object} SFCC settings
 */
function getSFCCSettings() {
    return {
        baseUrl:     'https://' + request.httpHost,
        bmClientId:  cfg.sfcc.bmClientId,
        bmUsername:  creds.bmUsername,
        bmPassword:  creds.bmPassword,
        metaVersion: cfg.sfcc.metaVersion
    };
}

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function metaUrl(path) {
    var s = getSFCCSettings();
    return s.baseUrl + '/s/-/dw/data/' + s.metaVersion + path + '?client_id=' + encodeURIComponent(s.bmClientId);
}

/**
 * Get SFCC BM User Grant access token.
 * @returns {string} access_token
 */
function getSFCCToken() {
    var s           = getSFCCSettings();
    if (!s.bmUsername || !s.bmPassword || !s.bmClientId) {
        throw new Error('SFCC BM credentials are not configured. Set Site Preferences → B2C Migration Console.');
    }
    var credentials = toBase64(s.bmUsername + ':' + s.bmPassword + ':' + s.bmClientId);
    var body        = 'grant_type=urn%3Ademandware%3Aparams%3Aoauth%3Agrant-type%3Aclient-id%3Adwsid%3Adwsecuretoken&client_id=' + encodeURIComponent(s.bmClientId);

    var res = serviceHttp.post('sfcc',
        s.baseUrl + '/dw/oauth2/access_token?client_id=' + encodeURIComponent(s.bmClientId),
        {
            Authorization:  'Basic ' + credentials,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    );

    if (res.status !== 200 || !res.data || !res.data.access_token) {
        var detail = '';
        if (res.data && (res.data.error_description || res.data.error)) {
            detail = ': ' + (res.data.error_description || res.data.error);
        } else if (res.text) {
            detail = ': ' + String(res.text).substring(0, 180);
        }
        throw new Error('SFCC token failed (' + res.status + ')' + detail);
    }
    return res.data.access_token;
}

function doPut(url, token, payload) {
    return serviceHttp.put('sfcc', url, {
        Authorization:  'Bearer ' + token,
        'Content-Type': 'application/json'
    }, JSON.stringify(payload));
}

function doPost(url, token, payload) {
    return serviceHttp.post('sfcc', url, {
        Authorization:  'Bearer ' + token,
        'Content-Type': 'application/json'
    }, JSON.stringify(payload));
}

function doGet(url, token) {
    return serviceHttp.get('sfcc', url, {
        Authorization:  'Bearer ' + token,
        'Content-Type': 'application/json'
    });
}

/**
 * Get every attribute definition for an SFCC system object type.
 * @param {string} token
 * @param {string} objectType
 * @returns {Array<{ id: string, displayName: string, system: boolean, localizable: boolean|null, valueType: string }>}
 */
function getAttributeDefinitions(token, objectType) {
    var attrs    = [];
    var start    = 0;
    var pageSize = 200;
    var total    = null;

    do {
        var url = metaUrl('/system_object_definitions/' + objectType + '/attribute_definitions') + '&count=' + pageSize + '&start=' + start;
        var res = doGet(url, token);
        if (res.status !== 200) break;

        if (total === null) total = res.data.total || 0;
        var page = res.data.data || [];
        for (var i = 0; i < page.length; i++) {
            var a = page[i];
            var locRaw = a.localizable;
            var locKnown = (locRaw === true || locRaw === false
                || locRaw === 1 || locRaw === 0
                || locRaw === 'true' || locRaw === 'false');
            attrs.push({
                id:           a.id,
                displayName:  (a.display_name && a.display_name.default) || a.id,
                system:       !!a.system,
                localizable:  locKnown ? (locRaw === true || locRaw === 1 || locRaw === 'true') : null,
                valueType:    a.value_type || a.valueType || a['value-type'] || ''
            });
        }
        start += pageSize;
    } while (start < total);

    return attrs;
}

/**
 * @param {string} token
 * @param {string} objectType
 * @returns {Object}
 */
function getExistingAttributeIds(token, objectType) {
    var attrs = getAttributeDefinitions(token, objectType);
    var ids   = {};
    for (var i = 0; i < attrs.length; i++) { ids[attrs[i].id] = true; }
    return ids;
}

/**
 * @param {string} token
 * @param {string} objectType
 * @param {Object} attrDef
 * @returns {boolean}
 */
function createAttributeDefinition(token, objectType, attrDef) {
    var url = metaUrl('/system_object_definitions/' + objectType + '/attribute_definitions/' + encodeURIComponent(attrDef.id));
    var res = doPut(url, token, attrDef);
    if (res.status >= 400) {
        throw new Error('Attribute create failed [' + objectType + '.' + attrDef.id + '] (' + res.status + ')');
    }
    return true;
}

/**
 * @param {string} token
 * @param {string} objectType
 * @param {Array} attrDefs
 * @returns {Object}
 */
function migrateObjectSchema(token, objectType, attrDefs) {
    var result   = { created: 0, skipped: 0, failed: 0 };
    var existing = getExistingAttributeIds(token, objectType);

    for (var i = 0; i < attrDefs.length; i++) {
        var def = attrDefs[i];
        if (existing[def.id]) {
            result.skipped++;
            continue;
        }
        try {
            createAttributeDefinition(token, objectType, def);
            result.created++;
        } catch (e) {
            result.failed++;
        }
    }
    return result;
}

/**
 * @param {string} token
 * @param {string} objectType
 * @param {string} groupId
 * @param {string} displayName
 */
function ensureAttributeGroup(token, objectType, groupId, displayName) {
    var url = metaUrl('/system_object_definitions/' + objectType + '/attribute_groups/' + encodeURIComponent(groupId));
    var getRes = doGet(url, token);
    if (getRes.status === 200) return true;
    var res = doPut(url, token, {
        id:           groupId,
        display_name: { default: displayName || groupId },
        position:     1
    });
    if (res.status >= 400) {
        throw new Error('Attribute group ensure failed [' + objectType + '/' + groupId + '] (' + res.status + ')');
    }
    return true;
}

/**
 * @param {string} token
 * @param {string} objectType
 * @param {string} groupId
 * @param {string} attributeId
 */
function addAttributeToGroup(token, objectType, groupId, attributeId) {
    var url = metaUrl(
        '/system_object_definitions/' + objectType +
        '/attribute_groups/' + encodeURIComponent(groupId) +
        '/attribute_definitions/' + encodeURIComponent(attributeId)
    );
    var res = doPut(url, token, { id: attributeId, position: 0 });
    if (res.status >= 400) {
        throw new Error('Add attr to group failed [' + groupId + '/' + attributeId + '] (' + res.status + ')');
    }
    return true;
}

/**
 * @param {string} token
 * @param {string} objectType
 * @param {string} attrId
 * @returns {boolean}
 */
function deleteAttributeDefinition(token, objectType, attrId) {
    var res = serviceHttp.del('sfcc',
        metaUrl('/system_object_definitions/' + objectType + '/attribute_definitions/' + encodeURIComponent(attrId)),
        { Authorization: 'Bearer ' + token }
    );
    if (res.status >= 400 && res.status !== 404) {
        throw new Error('Delete failed [' + objectType + '.' + attrId + '] (' + res.status + ')');
    }
    return true;
}

module.exports = {
    getSFCCToken:              getSFCCToken,
    getSFCCSettings:           getSFCCSettings,
    doGet:                     doGet,
    getAttributeDefinitions:   getAttributeDefinitions,
    getExistingAttributeIds:   getExistingAttributeIds,
    createAttributeDefinition: createAttributeDefinition,
    deleteAttributeDefinition: deleteAttributeDefinition,
    migrateObjectSchema:       migrateObjectSchema,
    ensureAttributeGroup:      ensureAttributeGroup,
    addAttributeToGroup:       addAttributeToGroup,
    doPut:                     doPut,
    doPost:                    doPost
};
