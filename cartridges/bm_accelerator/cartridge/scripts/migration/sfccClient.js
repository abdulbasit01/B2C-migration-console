'use strict';

/* global request */

var HTTPClient = require('dw/net/HTTPClient');
var Encoding   = require('dw/crypto/Encoding');
var Bytes      = require('dw/util/Bytes');
var cfg        = require('*/cartridge/scripts/migration/configAccessor');
var creds      = require('*/cartridge/scripts/migration/sfccCredentialsAccessor');

/**
 * Build runtime SFCC settings — baseUrl from live request, credentials from generated files.
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
    var credentials = toBase64(s.bmUsername + ':' + s.bmPassword + ':' + s.bmClientId);
    var body        = 'grant_type=urn%3Ademandware%3Aparams%3Aoauth%3Agrant-type%3Aclient-id%3Adwsid%3Adwsecuretoken&client_id=' + encodeURIComponent(s.bmClientId);

    var client = new HTTPClient();
    client.setTimeout(30000);
    client.open('POST', s.baseUrl + '/dw/oauth2/access_token?client_id=' + encodeURIComponent(s.bmClientId));
    client.setRequestHeader('Authorization', 'Basic ' + credentials);
    client.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    client.send(body);

    var text = client.getText();
    var data = JSON.parse(text || '{}');
    if (client.getStatusCode() !== 200 || !data.access_token) {
        throw new Error('SFCC token failed (' + client.getStatusCode() + '): ' + text);
    }
    return data.access_token;
}

function doPut(url, token, payload) {
    var client = new HTTPClient();
    client.setTimeout(30000);
    client.open('PUT', url);
    client.setRequestHeader('Authorization', 'Bearer ' + token);
    client.setRequestHeader('Content-Type', 'application/json');
    client.send(JSON.stringify(payload));
    return { status: client.getStatusCode(), text: client.getText() };
}

function doPost(url, token, payload) {
    var client = new HTTPClient();
    client.setTimeout(30000);
    client.open('POST', url);
    client.setRequestHeader('Authorization', 'Bearer ' + token);
    client.setRequestHeader('Content-Type', 'application/json');
    client.send(JSON.stringify(payload));
    return { status: client.getStatusCode(), text: client.getText() };
}

function doGet(url, token) {
    var client = new HTTPClient();
    client.setTimeout(30000);
    client.open('GET', url);
    client.setRequestHeader('Authorization', 'Bearer ' + token);
    client.setRequestHeader('Content-Type', 'application/json');
    client.send();
    return { status: client.getStatusCode(), data: JSON.parse(client.getText() || '{}') };
}

/**
 * Get all existing custom attribute IDs for an SFCC system object type.
 * @param {string} token - SFCC access token
 * @param {string} objectType - SFCC system object (Product, Customer, Order, etc.)
 * @returns {Object} map of existing attribute IDs { id: true }
 */
function getExistingAttributeIds(token, objectType) {
    var ids      = {};
    var start    = 0;
    var pageSize = 200;
    var total    = null;

    do {
        var url = metaUrl('/system_object_definitions/' + objectType + '/attribute_definitions') + '&count=' + pageSize + '&start=' + start;
        var res = doGet(url, token);
        if (res.status !== 200) break;

        if (total === null) total = res.data.total || 0;
        var page = res.data.data || [];
        for (var i = 0; i < page.length; i++) { ids[page[i].id] = true; }
        start += pageSize;
    } while (start < total);

    return ids;
}


/**
 * Create a single custom attribute definition on an SFCC system object.
 * @param {string} token - SFCC access token
 * @param {string} objectType - SFCC system object (Product, Customer, Order, etc.)
 * @param {Object} attrDef - attribute definition payload from transformers.js
 * @returns {boolean} true if created, false if already exists
 */
function createAttributeDefinition(token, objectType, attrDef) {
    var url = metaUrl('/system_object_definitions/' + objectType + '/attribute_definitions/' + encodeURIComponent(attrDef.id));
    var res = doPut(url, token, attrDef);
    if (res.status >= 400) {
        throw new Error('Attribute create failed [' + objectType + '.' + attrDef.id + '] (' + res.status + '): ' + res.text);
    }
    return true;
}

/**
 * Migrate schema for one SFCC object type: compare existing attributes with new ones, create missing.
 * @param {string} token - SFCC access token
 * @param {string} objectType - SFCC system object type
 * @param {Array} attrDefs - attribute definition payloads from transformers.js
 * @returns {Object} { created, skipped, failed }
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
 * Create (or update) a custom attribute group on an SFCC system object.
 * Idempotent — safe to call even if the group already exists.
 * @param {string} token       - SFCC access token
 * @param {string} objectType  - SFCC system object type (e.g. 'Profile')
 * @param {string} groupId     - attribute group ID
 * @param {string} displayName - human-readable group name
 */
function ensureAttributeGroup(token, objectType, groupId, displayName) {
    var url = metaUrl('/system_object_definitions/' + objectType + '/attribute_groups/' + encodeURIComponent(groupId));
    var res = doPut(url, token, {
        id:           groupId,
        display_name: { default: displayName || groupId },
        position:     1
    });
    if (res.status >= 400) {
        throw new Error('Attribute group ensure failed [' + objectType + '/' + groupId + '] (' + res.status + '): ' + res.text);
    }
    return true;
}

/**
 * Add an attribute definition to an attribute group so it appears in BM.
 * Uses PUT …/attribute_groups/{groupId}/attribute_definitions/{attributeId}
 * which is the standard SFCC OCAPI pattern for linking a definition to a group.
 * @param {string} token       - SFCC access token
 * @param {string} objectType  - SFCC system object type
 * @param {string} groupId     - attribute group ID
 * @param {string} attributeId - attribute definition ID to link
 */
function addAttributeToGroup(token, objectType, groupId, attributeId) {
    var url = metaUrl(
        '/system_object_definitions/' + objectType +
        '/attribute_groups/' + encodeURIComponent(groupId) +
        '/attribute_definitions/' + encodeURIComponent(attributeId)
    );
    var res = doPut(url, token, { id: attributeId, position: 0 });
    if (res.status >= 400) {
        throw new Error('Add attr to group failed [' + groupId + '/' + attributeId + '] (' + res.status + '): ' + res.text);
    }
    return true;
}

/**
 * Delete a single custom attribute definition from an SFCC system object.
 * @param {string} token      - SFCC access token
 * @param {string} objectType - SFCC system object type
 * @param {string} attrId     - attribute ID to delete
 * @returns {boolean} true if deleted or not found
 */
function deleteAttributeDefinition(token, objectType, attrId) {
    var client = new HTTPClient();
    client.setTimeout(30000);
    client.open('DELETE', metaUrl('/system_object_definitions/' + objectType + '/attribute_definitions/' + encodeURIComponent(attrId)));
    client.setRequestHeader('Authorization', 'Bearer ' + token);
    client.send();
    var status = client.getStatusCode();
    if (status >= 400 && status !== 404) {
        throw new Error('Delete failed [' + objectType + '.' + attrId + '] (' + status + ')');
    }
    return true;
}

module.exports = {
    getSFCCToken:              getSFCCToken,
    getSFCCSettings:           getSFCCSettings,
    doGet:                     doGet,
    getExistingAttributeIds:   getExistingAttributeIds,
    createAttributeDefinition: createAttributeDefinition,
    deleteAttributeDefinition: deleteAttributeDefinition,
    migrateObjectSchema:       migrateObjectSchema,
    ensureAttributeGroup:      ensureAttributeGroup,
    addAttributeToGroup:       addAttributeToGroup
};
