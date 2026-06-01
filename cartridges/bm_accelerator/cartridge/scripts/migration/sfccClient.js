'use strict';

var HTTPClient = require('dw/net/HTTPClient');
var Encoding   = require('dw/crypto/Encoding');
var Bytes      = require('dw/util/Bytes');
var cfg        = require('*/cartridge/scripts/migration/config');
var creds      = require('*/cartridge/scripts/migration/sfcc-credentials');

// baseUrl is derived from the live request — no hardcoding needed
function getSFCCSettings() {
    return {
        baseUrl:         'https://' + request.httpHost,
        bmClientId:      cfg.sfcc.bmClientId,
        bmUsername:      creds.bmUsername,
        bmPassword:      creds.bmPassword,
        version:         cfg.sfcc.version,
        metaVersion:     cfg.sfcc.metaVersion,
        catalogId:       cfg.sfcc.catalogId,
        inventoryListId: cfg.sfcc.inventoryListId
    };
}

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function ocapiUrl(path) {
    var s = getSFCCSettings();
    return s.baseUrl + '/s/-/dw/data/' + s.version + path + '?client_id=' + encodeURIComponent(s.bmClientId);
}

function metaUrl(path) {
    var s = getSFCCSettings();
    return s.baseUrl + '/s/-/dw/data/' + s.metaVersion + path + '?client_id=' + encodeURIComponent(s.bmClientId);
}

function getSFCCToken() {
    var s = getSFCCSettings();

    if (!s.bmUsername || !s.bmPassword) {
        throw new Error('BM credentials not set. Go to BM → Site Preferences → Migration and set migrationBMUsername and migrationBMPassword.');
    }

    var credentials = toBase64(s.bmUsername + ':' + s.bmPassword + ':' + s.bmClientId);
    var body = 'grant_type=urn%3Ademandware%3Aparams%3Aoauth%3Agrant-type%3Aclient-id%3Adwsid%3Adwsecuretoken&client_id=' + encodeURIComponent(s.bmClientId);

    var client = new HTTPClient();
    client.setTimeout(30000);
    client.open('POST', s.baseUrl + '/dw/oauth2/access_token?client_id=' + encodeURIComponent(s.bmClientId));
    client.setRequestHeader('Authorization', 'Basic ' + credentials);
    client.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    client.send(body);

    var text = client.getText();
    var data = JSON.parse(text || '{}');

    if (client.getStatusCode() !== 200 || !data.access_token) {
        throw new Error('SFCC BM token failed (' + client.getStatusCode() + '): ' + text);
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
    var text = client.getText();
    return { status: client.getStatusCode(), data: JSON.parse(text || '{}') };
}

function getExistingAttributeIds(token, objectType) {
    var ids = {};
    var start = 0;
    var pageSize = 200;
    var total = null;

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

function createAttribute(token, objectType, attrId, sampleValue) {
    var typeId = (typeof sampleValue === 'boolean') ? 'boolean'
               : (typeof sampleValue === 'number' && sampleValue % 1 === 0) ? 'int'
               : (typeof sampleValue === 'number') ? 'double'
               : 'string';

    var url = metaUrl('/system_object_definitions/' + objectType + '/attribute_definitions/' + encodeURIComponent(attrId));
    doPut(url, token, {
        id: attrId, value_type: typeId, mandatory: false, searchable: false,
        externally_defined: false, externally_managed: false, order_required: false,
        display_name: { default: attrId }
    });
}

function ensureAttributes(token, objectType, records) {
    var existing = getExistingAttributeIds(token, objectType);
    var needed = {};

    for (var i = 0; i < records.length; i++) {
        var attrs = records[i].custom_attributes || [];
        for (var j = 0; j < attrs.length; j++) {
            var id = attrs[j].attribute_id;
            if (id && !existing[id] && !needed[id]) needed[id] = attrs[j].value;
        }
    }

    var missingKeys = Object.keys(needed);
    for (var k = 0; k < missingKeys.length; k++) {
        try { createAttribute(token, objectType, missingKeys[k], needed[missingKeys[k]]); } catch (e) {}
    }
}

function upsertProduct(token, product) {
    var s = getSFCCSettings();
    var payload = { name: product.name, online: product.online, searchable: product.searchable, owning_catalog_id: s.catalogId };
    if (product.short_description) payload.short_description = product.short_description;
    if (product.primary_category_id) payload.primary_category_id = product.primary_category_id;

    var attrs = product.custom_attributes || [];
    for (var i = 0; i < attrs.length; i++) {
        if (attrs[i].attribute_id) payload['c_' + attrs[i].attribute_id] = attrs[i].value;
    }

    var res = doPut(ocapiUrl('/products/' + encodeURIComponent(product.id)), token, payload);
    if (res.status >= 400) throw new Error('Product upsert failed (' + res.status + '): ' + res.text);
}

function upsertCategory(token, category) {
    var s = getSFCCSettings();
    var payload = { id: category.id, name: category.name, online: category.online };
    if (category.description) payload.description = category.description;
    if (category.parent_category_id) payload.parent_category_id = category.parent_category_id;

    var res = doPut(ocapiUrl('/catalogs/' + encodeURIComponent(s.catalogId) + '/categories/' + encodeURIComponent(category.id)), token, payload);
    if (res.status >= 400) throw new Error('Category upsert failed (' + res.status + '): ' + res.text);
}

function upsertCustomer(token, customer) {
    var searchClient = new HTTPClient();
    searchClient.setTimeout(30000);
    searchClient.open('POST', ocapiUrl('/customer_search'));
    searchClient.setRequestHeader('Authorization', 'Bearer ' + token);
    searchClient.setRequestHeader('Content-Type', 'application/json');
    searchClient.send(JSON.stringify({ query: { text_query: { fields: ['email'], search_phrase: customer.email } }, count: 1 }));

    var searchData = JSON.parse(searchClient.getText() || '{}');
    var existing = searchData.hits && searchData.hits[0] ? searchData.hits[0] : null;
    var res;

    if (existing) {
        var patchClient = new HTTPClient();
        patchClient.setTimeout(30000);
        patchClient.open('PATCH', ocapiUrl('/customers/' + existing.customer_id));
        patchClient.setRequestHeader('Authorization', 'Bearer ' + token);
        patchClient.setRequestHeader('Content-Type', 'application/json');
        patchClient.send(JSON.stringify(customer));
        res = { status: patchClient.getStatusCode() };
    } else {
        res = doPost(ocapiUrl('/customers'), token, customer);
    }
    if (res.status >= 400) throw new Error('Customer upsert failed (' + res.status + ')');
}

function upsertInventory(token, record) {
    var s = getSFCCSettings();
    doPut(ocapiUrl('/inventory_lists/' + encodeURIComponent(s.inventoryListId)), token, {
        id: s.inventoryListId, description: 'Migrated from commercetools', on_order: false, default_in_stock: false
    });
    var res = doPut(ocapiUrl('/inventory_lists/' + encodeURIComponent(s.inventoryListId) + '/product_inventory_records/' + encodeURIComponent(record.product_id)), token, record);
    if (res.status >= 400) throw new Error('Inventory upsert failed (' + res.status + ')');
}

module.exports = {
    getSFCCToken: getSFCCToken,
    ensureAttributes: ensureAttributes,
    upsertProduct: upsertProduct,
    upsertCategory: upsertCategory,
    upsertCustomer: upsertCustomer,
    upsertInventory: upsertInventory
};
