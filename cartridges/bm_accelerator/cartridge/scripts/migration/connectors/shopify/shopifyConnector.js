'use strict';

var http        = require('*/cartridge/scripts/migration/core/http');
var typeMap     = require('*/cartridge/scripts/migration/connectors/shopify/shopifyTypeMap');
var transformer = require('*/cartridge/scripts/migration/connectors/shopify/shopifyTransformer');
var cfg         = require('*/cartridge/scripts/migration/configAccessor');

// ─── Standard Shopify fields (fixed schema, no API call needed) ───────────────

var STANDARD_PRODUCT_FIELDS = [
    { key: 'title',        type: 'single_line_text_field',     label: 'Title' },
    { key: 'body_html',    type: 'multi_line_text_field',      label: 'Description' },
    { key: 'vendor',       type: 'single_line_text_field',     label: 'Vendor' },
    { key: 'product_type', type: 'single_line_text_field',     label: 'Product Type' },
    { key: 'handle',       type: 'single_line_text_field',     label: 'Handle' },
    { key: 'tags',         type: 'list.single_line_text_field', label: 'Tags' },
    { key: 'status',       type: 'single_line_text_field',     label: 'Status' }
];

var STANDARD_VARIANT_FIELDS = [
    { key: 'variant_sku',               type: 'single_line_text_field', label: 'Variant SKU' },
    { key: 'variant_barcode',           type: 'single_line_text_field', label: 'Barcode' },
    { key: 'variant_price',             type: 'money',                  label: 'Variant Price' },
    { key: 'variant_compare_at_price',  type: 'money',                  label: 'Compare at Price' },
    { key: 'variant_weight',            type: 'number_decimal',         label: 'Variant Weight' },
    { key: 'variant_taxable',           type: 'boolean',                label: 'Taxable' },
    { key: 'variant_requires_shipping', type: 'boolean',                label: 'Requires Shipping' }
];

// Owner types fetched per runner task
var TASK_OWNER_TYPES = {
    Product:  ['PRODUCT', 'VARIANT'],
    Category: ['COLLECTION'],
    Customer: ['CUSTOMER'],
    Order:    ['ORDER']
};

// ─── Token cache (per-request scope in SFCC — no persistent process memory) ──

var _cachedToken    = null;
var _tokenExpiresAt = 0;

function fetchAccessToken(creds) {
    if (_cachedToken && Date.now() < _tokenExpiresAt - 60000) return _cachedToken;

    var store = (creds.storeUrl || '').replace(/\/$/, '');
    var body  = 'grant_type=client_credentials'
              + '&client_id='     + encodeURIComponent(creds.clientId)
              + '&client_secret=' + encodeURIComponent(creds.clientSecret);

    var res = http.post(
        store + '/admin/oauth/access_token',
        { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    );

    if (res.status !== 200 || !res.data || !res.data.access_token) {
        throw new Error('Shopify token request failed (' + res.status + '): check Client ID and Secret.');
    }

    _cachedToken    = res.data.access_token;
    _tokenExpiresAt = Date.now() + (res.data.expires_in || 3600) * 1000;
    return _cachedToken;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validateCreds(creds) {
    if (!creds || !creds.storeUrl || !creds.clientId || !creds.clientSecret) {
        throw new Error('Shopify credentials are not configured. Please enter your Store URL, Client ID, and Secret in Step 1.');
    }
}

function fmt(n) {
    return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function adminBase(creds) {
    var store   = (creds.storeUrl || '').replace(/\/$/, '');
    var version = creds.apiVersion || '2025-01';
    return store + '/admin/api/' + version;
}

function authHeaders(creds) {
    return { 'X-Shopify-Access-Token': fetchAccessToken(creds), 'Content-Type': 'application/json' };
}

// ─── Metafield definitions via GraphQL ───────────────────────────────────────

function fetchMetafieldDefs(creds, ownerType) {
    var url   = adminBase(creds) + '/graphql.json';
    var query = '{ metafieldDefinitions(ownerType: ' + ownerType + ', first: 250) { nodes { name key namespace type { name } } } }';
    var res   = http.post(url, authHeaders(creds), JSON.stringify({ query: query }));
    if (res.status !== 200 || !res.data || !res.data.data) return [];
    var mfDefs = res.data.data.metafieldDefinitions;
    return (mfDefs && mfDefs.nodes) ? mfDefs.nodes : [];
}

// ─── Connection test ──────────────────────────────────────────────────────────

function testConnectionWith(creds) {
    if (!creds.storeUrl || !creds.clientId || !creds.clientSecret) {
        throw new Error('Store URL, Client ID, and Secret are required.');
    }
    var res = http.get(adminBase(creds) + '/shop.json', authHeaders(creds));
    if (res.status !== 200 || !res.data.shop) {
        throw new Error('Connection failed (' + res.status + '): check store URL and access token.');
    }
    var shop = res.data.shop;
    return { ok: true, project: { key: shop.myshopify_domain || shop.domain, name: shop.name } };
}

function testConnection() {
    return testConnectionWith(cfg.shopify);
}

// ─── Schema counts ────────────────────────────────────────────────────────────

function getSchemaCounts() {
    var c          = cfg.shopify;
    validateCreds(c);
    var ownerTypes = Object.keys(typeMap.OWNER_TYPE_MAP);
    var byResource = {};
    var total      = 0;

    for (var i = 0; i < ownerTypes.length; i++) {
        var ownerType = ownerTypes[i];
        var sfccType  = typeMap.OWNER_TYPE_MAP[ownerType];
        var defs      = fetchMetafieldDefs(c, ownerType);
        if (defs.length) {
            total += defs.length;
            byResource[sfccType] = (byResource[sfccType] || 0) + defs.length;
        }
    }

    return {
        standardProductFields: STANDARD_PRODUCT_FIELDS.length,
        standardVariantFields: STANDARD_VARIANT_FIELDS.length,
        metafieldDefs:         total,
        byResource:            byResource
    };
}

// ─── Attribute definitions ────────────────────────────────────────────────────

function getAttrDefsForTask(task) {
    var c          = cfg.shopify;
    var ownerTypes = TASK_OWNER_TYPES[task];
    var seen       = {};
    var defs       = [];

    function push(def) {
        if (!seen[def.id]) { seen[def.id] = true; defs.push(def); }
    }

    if (task === 'Product') {
        var stdFields = STANDARD_PRODUCT_FIELDS.concat(STANDARD_VARIANT_FIELDS);
        for (var sf = 0; sf < stdFields.length; sf++) {
            push(transformer.transformStandardField(stdFields[sf]));
        }
    }

    if (ownerTypes) {
        for (var ot = 0; ot < ownerTypes.length; ot++) {
            var metaDefs = fetchMetafieldDefs(c, ownerTypes[ot]);
            for (var m = 0; m < metaDefs.length; m++) {
                push(transformer.transformMetafieldDef(metaDefs[m]));
            }
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

function buildFetchContent(counts) {
    var byResource  = counts.byResource || {};
    var totalFields = (counts.standardProductFields || 0) + (counts.standardVariantFields || 0) + (counts.metafieldDefs || 0);
    var sections    = [];

    var productItems = [
        'Standard product fields (' + fmt(counts.standardProductFields || 0) + ')',
        'Standard variant fields (' + fmt(counts.standardVariantFields || 0) + ')'
    ];
    if (byResource.Product) productItems.push('Product metafield definitions (' + fmt(byResource.Product) + ')');
    sections.push({ taskId: 'Product', title: 'Product', items: productItems, selectable: true });

    var OTHER_TASKS        = ['Category', 'Customer', 'Order'];
    var TASK_SOURCE_LABELS = { Category: 'Collection', Customer: 'Customer', Order: 'Order' };
    for (var i = 0; i < OTHER_TASKS.length; i++) {
        var task = OTHER_TASKS[i];
        if (byResource[task]) {
            sections.push({
                taskId:     task,
                title:      task,
                items:      [TASK_SOURCE_LABELS[task] + ' metafield definitions (' + fmt(byResource[task]) + ')'],
                selectable: true
            });
        }
    }

    return {
        titleSuffix: 'Select schemas to migrate',
        intro:       'Standard Shopify fields are always included. Metafield definitions are loaded live.',
        sections:    sections,
        summary:     'Total schema definitions: ' + fmt(totalFields)
    };
}

// ─── AI Map step content (Step 3) ────────────────────────────────────────────

function toGroup(title, mappings) {
    var existsCount = 0;
    for (var i = 0; i < mappings.length; i++) { if (mappings[i].exists) existsCount++; }
    return { title: title, total: mappings.length, existsCount: existsCount, newCount: mappings.length - existsCount, mappings: mappings };
}

function buildAiMapContent(selectedTasks, existingByTask) {
    var c           = cfg.shopify;
    validateCreds(c);
    var existing    = existingByTask || {};
    var groups      = [];
    var seen        = {};
    var totalAttrs  = 0;

    var showProduct     = !selectedTasks || selectedTasks.indexOf('Product') >= 0;
    var productMappings = [];

    if (showProduct) {
        var stdFields = STANDARD_PRODUCT_FIELDS.concat(STANDARD_VARIANT_FIELDS);
        for (var sf = 0; sf < stdFields.length; sf++) {
            var std = stdFields[sf];
            if (seen['Product__' + std.key]) continue;
            seen['Product__' + std.key] = true;
            totalAttrs++;
            productMappings.push({
                source:     std.key + ' (' + std.type + ')',
                target:     'Product → ' + typeMap.resolveMetafieldType(std.type),
                confidence: typeMap.confidence(std.type),
                exists:     !!(existing.Product && existing.Product[std.key])
            });
        }
    }

    var ownerGroups  = ['PRODUCT', 'VARIANT', 'COLLECTION', 'CUSTOMER', 'ORDER'];
    var customGroups = {};

    for (var oi = 0; oi < ownerGroups.length; oi++) {
        var ownerType = ownerGroups[oi];
        var sfccType  = typeMap.OWNER_TYPE_MAP[ownerType];
        if (!sfccType) continue;

        if (selectedTasks && selectedTasks.indexOf(sfccType) < 0) continue;

        var defs = fetchMetafieldDefs(c, ownerType);
        totalAttrs += defs.length;
        if (!customGroups[sfccType]) customGroups[sfccType] = [];

        for (var di = 0; di < defs.length; di++) {
            var def    = defs[di];
            var mfId   = (def.namespace ? def.namespace + '__' + def.key : def.key).replace(/[^a-zA-Z0-9_]/g, '_');
            var mfType = def.type && def.type.name ? def.type.name : 'single_line_text_field';
            var mfKey  = sfccType + '__' + mfId;
            if (seen[mfKey]) continue;
            seen[mfKey] = true;
            customGroups[sfccType].push({
                source:     def.namespace + '.' + def.key + ' (' + mfType + ')',
                target:     sfccType + ' → ' + typeMap.resolveMetafieldType(mfType),
                confidence: typeMap.confidence(mfType),
                exists:     !!(existing[sfccType] && existing[sfccType][mfId])
            });
        }
    }

    // Merge VARIANT metafields (also SFCC Product) into product group
    if (customGroups.Product) {
        for (var pm = 0; pm < customGroups.Product.length; pm++) productMappings.push(customGroups.Product[pm]);
        delete customGroups.Product;
    }
    if (showProduct && productMappings.length) groups.push(toGroup('Product', productMappings));

    var otherTypes = Object.keys(customGroups);
    for (var ot = 0; ot < otherTypes.length; ot++) {
        var oType = otherTypes[ot];
        if (customGroups[oType].length) groups.push(toGroup(oType, customGroups[oType]));
    }

    return {
        titleSuffix: 'Schema field mapping',
        intro:       'Shopify field → SFCC value_type mappings. ' + totalAttrs + ' total attribute(s) across ' + groups.length + ' entity type(s).',
        groups:      groups
    };
}

// ─── Credential injection (for migrationData connect form pre-fill) ───────────

function injectCredentials(fields) {
    var s   = cfg.shopify || {};
    var out = [];
    for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        var value = field.value;
        if (field.name === 'storeUrl')                            value = s.storeUrl     || value;
        else if (field.name === 'clientId')                       value = s.clientId     || value;
        else if (field.name === 'clientSecret' && s.clientSecret) value = '••••••••';
        else if (field.name === 'apiVersion')                     value = s.apiVersion   || value;
        out.push({ name: field.name, label: field.label, type: field.type, required: field.required, value: value, placeholder: field.placeholder || '' });
    }
    return out;
}

// ─── Default tasks ────────────────────────────────────────────────────────────

function getDefaultTasks() {
    return ['Product', 'Category', 'Customer', 'Order'];
}

// ─── Public interface ─────────────────────────────────────────────────────────

module.exports = {
    id:                  'shopify',
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
