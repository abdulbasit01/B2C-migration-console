'use strict';

var Encoding       = require('dw/crypto/Encoding');
var Bytes          = require('dw/util/Bytes');
var http           = require('*/cartridge/scripts/migration/core/http');
var typeMap        = require('*/cartridge/scripts/migration/connectors/ctp/ctpTypeMap');
var transformer    = require('*/cartridge/scripts/migration/connectors/ctp/ctpTransformer');
var cfg            = require('*/cartridge/scripts/migration/configAccessor');
var nativeFieldMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function fmt(n) {
    return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function getToken(creds) {
    var c    = creds || cfg.ctp;
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

// ─── Paginated fetch ──────────────────────────────────────────────────────────

function fetchAll(endpoint, token) {
    var c      = cfg.ctp;
    var all    = [];
    var offset = 0;
    var limit  = 100;
    var total  = null;

    do {
        var qs  = '?limit=' + limit + '&offset=' + offset;
        var res = http.get(
            c.apiUrl + '/' + c.projectKey + endpoint + qs,
            { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
        );
        if (res.status !== 200) break;

        var results = res.data.results || [];
        if (total === null) total = res.data.total || 0;
        for (var i = 0; i < results.length; i++) all.push(results[i]);
        offset += results.length;
    } while (offset < total && results.length > 0);

    return all;
}

function fetchProductTypes(token) { return fetchAll('/product-types', token); }
function fetchCustomTypes(token)  { return fetchAll('/types', token); }

// ─── Connection test ──────────────────────────────────────────────────────────

function testConnectionWith(creds) {
    var token = getToken(creds);
    var res   = http.get(
        creds.apiUrl + '/' + creds.projectKey,
        { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    );
    if (res.status !== 200) {
        throw new Error('Project not found (' + res.status + '): check project key and API URL.');
    }
    return { ok: true, project: { key: res.data.key, name: res.data.name || creds.projectKey } };
}

function testConnection() {
    return testConnectionWith(cfg.ctp);
}

// ─── Schema counts ────────────────────────────────────────────────────────────

function getSchemaCounts() {
    var c     = cfg.ctp;
    var token = getToken();
    var auth  = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    var base  = c.apiUrl + '/' + c.projectKey;

    var ptRes        = http.get(base + '/product-types?limit=500', auth);
    var ctRes        = http.get(base + '/types?limit=500', auth);
    var productTypes = ptRes.status === 200 ? (ptRes.data.results || []) : [];
    var customTypes  = ctRes.status === 200 ? (ctRes.data.results || []) : [];

    var productAttrCount = 0;
    for (var i = 0; i < productTypes.length; i++) {
        productAttrCount += (productTypes[i].attributes || []).length;
    }

    var byResource = {};
    for (var j = 0; j < customTypes.length; j++) {
        var ct   = customTypes[j];
        var rids = ct.resourceTypeIds || [];
        var flds = (ct.fieldDefinitions || []).length;
        for (var k = 0; k < rids.length; k++) {
            var rid = rids[k];
            if (!byResource[rid]) byResource[rid] = { types: 0, fields: 0 };
            byResource[rid].types  += 1;
            byResource[rid].fields += flds;
        }
    }

    var customFieldTotal = 0;
    for (var m = 0; m < customTypes.length; m++) {
        customFieldTotal += (customTypes[m].fieldDefinitions || []).length;
    }

    return {
        productTypes:      productTypes.length,
        productAttributes: productAttrCount,
        customTypes:       customTypes.length,
        customFields:      customFieldTotal,
        byResource:        byResource
    };
}

// ─── Attribute definitions ────────────────────────────────────────────────────

function getAttrDefsForTask(task) {
    var token       = getToken();
    var seen        = {};
    var defs        = [];
    var customTypes = fetchCustomTypes(token);

    function push(def) {
        if (!seen[def.id]) { seen[def.id] = true; defs.push(def); }
    }

    if (task === 'Product') {
        var productTypes = fetchProductTypes(token);
        for (var pi = 0; pi < productTypes.length; pi++) {
            var attrs = productTypes[pi].attributes || [];
            for (var ai = 0; ai < attrs.length; ai++) {
                push(transformer.transformProductAttr(attrs[ai]));
            }
        }
    }

    var sfccObject = task === 'Product' ? 'Product' : task;

    for (var ci = 0; ci < customTypes.length; ci++) {
        var ct    = customTypes[ci];
        var rids  = ct.resourceTypeIds || [];
        var match = false;

        for (var ri = 0; ri < rids.length; ri++) {
            var rid      = rids[ri];
            var resolved = typeMap.resolveResourceType(rid);
            if (task === 'Product' && typeMap.PRODUCT_RESOURCE_IDS.indexOf(rid) >= 0) { match = true; break; }
            if (task !== 'Product' && resolved === sfccObject) { match = true; break; }
        }

        if (!match) continue;

        var fields = ct.fieldDefinitions || [];
        for (var fi = 0; fi < fields.length; fi++) {
            push(transformer.transformCustomField(fields[fi]));
        }
    }

    return defs;
}

function getAttrIdsForTask(task) {
    var defs = getAttrDefsForTask(task);
    var ids  = [];
    for (var i = 0; i < defs.length; i++) ids.push(defs[i].id);
    return ids;
}

// ─── Fetch step content (Step 2) ──────────────────────────────────────────────

var TASK_RESOURCES = {
    Product:                ['product', 'product-variant', 'product-price'],
    Category:               ['category'],
    Customer:               ['customer'],
    Order:                  ['order', 'order-edit', 'line-item', 'custom-line-item', 'cart', 'payment', 'payment-interface-interaction'],
    ProductInventoryRecord: ['inventory-entry'],
    ProductList:            ['shopping-list'],
    ProductListItem:        ['shopping-list-text-line-item'],
    Promotion:              ['cart-discount', 'discount-code']
};

var TASK_LABELS = {
    Product: 'Product', Category: 'Category', Customer: 'Customer', Order: 'Order',
    ProductInventoryRecord: 'Product Inventory Record', ProductList: 'Product List',
    ProductListItem: 'Product List Item', Promotion: 'Promotion'
};

var OTHER_RESOURCE_LABELS = {
    address: 'Address', store: 'Store', 'customer-group': 'Customer Group',
    channel: 'Channel', review: 'Review', asset: 'Asset',
    shipping: 'Shipping', 'shipping-method': 'Shipping Method'
};

function buildFetchContent(counts) {
    var byResource  = counts.byResource || {};
    var knownRids   = [];
    var sections    = [];
    var totalFields = (counts.productAttributes || 0) + (counts.customFields || 0);
    var taskNames   = Object.keys(TASK_RESOURCES);

    for (var t = 0; t < taskNames.length; t++) {
        var task      = taskNames[t];
        var resources = TASK_RESOURCES[task];
        var items     = [];
        var ctCount   = 0;
        var cfCount   = 0;

        if (task === 'Product') {
            items.push('Product attributes');
        }

        for (var r = 0; r < resources.length; r++) {
            var rid = resources[r];
            knownRids.push(rid);
            if (byResource[rid]) { ctCount += byResource[rid].types; cfCount += byResource[rid].fields; }
        }

        if (ctCount > 0) {
            items.push('Custom types');
            items.push('Custom fields');
        }

        if (items.length) {
            sections.push({ taskId: task, title: TASK_LABELS[task], items: items, selectable: true });
        }
    }

    var otherItems = [];
    var allRids    = Object.keys(byResource);
    for (var i = 0; i < allRids.length; i++) {
        var oRid = allRids[i];
        if (knownRids.indexOf(oRid) < 0) {
            var lbl = OTHER_RESOURCE_LABELS[oRid] || oRid;
            otherItems.push(lbl + ': ' + fmt(byResource[oRid].types) + ' type(s), ' + fmt(byResource[oRid].fields) + ' field(s)');
        }
    }
    if (otherItems.length) {
        sections.push({ taskId: null, title: 'Not Supported in This Migration', items: otherItems, selectable: false });
    }

    return {
        titleSuffix: 'Select schemas to migrate',
        intro:       'Choose which schemas to include. All are selected by default.',
        sections:    sections,
        summary:     'Total schema definitions: ' + fmt(totalFields)
    };
}

// ─── AI Map step content (Step 3) ────────────────────────────────────────────

var GROUP_ORDER = ['Category', 'Customer', 'Order', 'ProductInventoryRecord', 'ProductList', 'ProductListItem', 'Promotion', 'Profile', 'SitePreferences', 'CustomerGroup'];

function toGroup(title, mappings) {
    var existsCount = 0;
    for (var i = 0; i < mappings.length; i++) { if (mappings[i].exists) existsCount++; }
    return { title: title, total: mappings.length, existsCount: existsCount, newCount: mappings.length - existsCount, mappings: mappings };
}

function buildAiMapContent(selectedTasks, existingByTask) {
    var existing     = existingByTask || {};
    var token        = getToken();
    var productTypes = fetchProductTypes(token);
    var customTypes  = fetchCustomTypes(token);
    var groups       = [];
    var seen         = {};
    var totalAttrs   = 0;

    var showProduct     = !selectedTasks || selectedTasks.indexOf('Product') >= 0;
    var productMappings = [];

    for (var pi = 0; pi < productTypes.length; pi++) {
        var attrs = productTypes[pi].attributes || [];
        if (!showProduct) continue;
        totalAttrs += attrs.length;
        for (var ai = 0; ai < attrs.length; ai++) {
            var attr    = attrs[ai];
            var key     = 'Product__' + attr.name;
            if (seen[key]) continue;
            seen[key]   = true;
            var ctpType  = attr.type && attr.type.name ? attr.type.name : 'text';
            var rule     = nativeFieldMap.getRule('commercetools', 'Product', attr.name);
            var mapping  = {
                source:      attr.name + ' (' + ctpType + ')',
                attributeId: attr.name,
                target:      typeMap.resolveProductType(ctpType),
                confidence:  typeMap.confidence(ctpType),
                exists:      !!(existing.Product && existing.Product[attr.name])
            };
            if (rule) {
                mapping.sfccNativeField  = rule.sfccField;
                mapping.sfccNativeNote   = rule.note;
                mapping.sfccNativeAction = rule.action;
            }
            productMappings.push(mapping);
        }
    }

    var customGroups = {};
    for (var ci = 0; ci < customTypes.length; ci++) {
        var ct     = customTypes[ci];
        var rids   = ct.resourceTypeIds || [];
        var fields = ct.fieldDefinitions || [];
        totalAttrs += fields.length;

        var sfccObj = null;
        for (var ri = 0; ri < rids.length; ri++) {
            var resolved = typeMap.resolveResourceType(rids[ri]);
            if (resolved) { sfccObj = resolved; break; }
        }
        if (!sfccObj) continue;

        var runnerTask = sfccObj === 'Profile' ? 'Customer' : sfccObj;
        if (selectedTasks && selectedTasks.indexOf(runnerTask) < 0) continue;

        if (!customGroups[sfccObj]) customGroups[sfccObj] = [];

        for (var fi = 0; fi < fields.length; fi++) {
            var field = fields[fi];
            var fkey  = sfccObj + '__' + field.name;
            if (seen[fkey]) continue;
            seen[fkey] = true;
            var fType  = field.type && field.type.name ? field.type.name : 'String';
            customGroups[sfccObj].push({
                source:      field.name + ' (' + fType + ')',
                attributeId: field.name,
                target:      typeMap.resolveCustomFieldType(fType),
                confidence:  typeMap.confidence(fType),
                exists:      !!(existing[sfccObj] && existing[sfccObj][field.name])
            });
        }
    }

    if (customGroups.Product) {
        for (var pm = 0; pm < customGroups.Product.length; pm++) productMappings.push(customGroups.Product[pm]);
        delete customGroups.Product;
    }
    if (productMappings.length) groups.push(toGroup('Product', productMappings));

    for (var g = 0; g < GROUP_ORDER.length; g++) {
        var gKey = GROUP_ORDER[g];
        if (customGroups[gKey] && customGroups[gKey].length) {
            groups.push(toGroup(gKey, customGroups[gKey]));
            delete customGroups[gKey];
        }
    }
    var remaining = Object.keys(customGroups);
    for (var rem = 0; rem < remaining.length; rem++) {
        var rKey = remaining[rem];
        if (customGroups[rKey].length) groups.push(toGroup(rKey, customGroups[rKey]));
    }

    return {
        titleSuffix: 'Schema field mapping',
        intro:       'Live CTP attribute → SFCC value_type mappings.',
        groups:      groups
    };
}

// ─── Credential injection (for migrationData connect form pre-fill) ───────────

function injectCredentials(fields) {
    var c   = cfg.ctp || {};
    var out = [];
    for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        var value = field.value;
        if (field.name === 'projectKey')                          value = c.projectKey   || value;
        else if (field.name === 'clientId')                       value = c.clientId     || value;
        else if (field.name === 'clientSecret' && c.clientSecret) value = '••••••••';
        else if (field.name === 'apiUrl')                         value = c.apiUrl       || value;
        else if (field.name === 'scopes')                         value = c.scopes       || value;
        out.push({ name: field.name, label: field.label, type: field.type, required: field.required, value: value });
    }
    return out;
}

// ─── Default tasks ────────────────────────────────────────────────────────────

function getDefaultTasks() {
    return ['Product', 'Category', 'Customer', 'Order', 'ProductInventoryRecord', 'ProductList', 'ProductListItem', 'Promotion'];
}

// ─── Public interface ─────────────────────────────────────────────────────────

module.exports = {
    id:                  'commercetools',
    testConnectionWith:  testConnectionWith,
    testConnection:      testConnection,
    getSchemaCounts:     getSchemaCounts,
    getAttrDefsForTask:  getAttrDefsForTask,
    getAttrIdsForTask:   getAttrIdsForTask,
    injectCredentials:   injectCredentials,
    getDefaultTasks:     getDefaultTasks,
    buildFetchContent:   buildFetchContent,
    buildAiMapContent:   buildAiMapContent
};
