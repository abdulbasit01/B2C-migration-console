'use strict';

var http           = require('*/cartridge/scripts/migration/core/http');
var shopifyApi     = require('*/cartridge/scripts/migration/core/shopifyApi');
var typeMap        = require('*/cartridge/scripts/migration/connectors/shopify/shopifyTypeMap');
var transformer    = require('*/cartridge/scripts/migration/connectors/shopify/shopifyTransformer');
var cfg            = require('*/cartridge/scripts/migration/configAccessor');
var nativeFieldMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');

// ─── Standard fields per task (fixed schema, no API call needed) ──────────────

var STANDARD_PRODUCT_FIELDS = [
    { key: 'title',        type: 'single_line_text_field',      label: 'Title' },
    { key: 'body_html',    type: 'multi_line_text_field',       label: 'Description' },
    { key: 'vendor',       type: 'single_line_text_field',      label: 'Vendor' },
    { key: 'product_type', type: 'single_line_text_field',      label: 'Product Type' },
    { key: 'handle',       type: 'single_line_text_field',      label: 'Handle' },
    { key: 'tags',         type: 'list.single_line_text_field', label: 'Tags' },
    { key: 'status',       type: 'single_line_text_field',      label: 'Status' }
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

var STANDARD_CATEGORY_FIELDS = [
    { key: 'title',           type: 'single_line_text_field', label: 'Title' },
    { key: 'body_html',       type: 'multi_line_text_field',  label: 'Description' },
    { key: 'handle',          type: 'single_line_text_field', label: 'Handle' },
    { key: 'sort_order',      type: 'single_line_text_field', label: 'Sort Order' },
    { key: 'template_suffix', type: 'single_line_text_field', label: 'Template Suffix' }
];

var STANDARD_CUSTOMER_FIELDS = [
    { key: 'email',             type: 'single_line_text_field',      label: 'Email' },
    { key: 'first_name',        type: 'single_line_text_field',      label: 'First Name' },
    { key: 'last_name',         type: 'single_line_text_field',      label: 'Last Name' },
    { key: 'phone',             type: 'single_line_text_field',      label: 'Phone' },
    { key: 'tags',              type: 'list.single_line_text_field', label: 'Tags' },
    { key: 'note',              type: 'multi_line_text_field',       label: 'Note' },
    { key: 'verified_email',    type: 'boolean',                     label: 'Verified Email' },
    { key: 'accepts_marketing', type: 'boolean',                     label: 'Accepts Marketing' },
    { key: 'orders_count',      type: 'number_integer',              label: 'Orders Count' },
    { key: 'total_spent',       type: 'money',                       label: 'Total Spent' }
];

var STANDARD_ORDER_FIELDS = [
    { key: 'order_number',       type: 'number_integer',              label: 'Order Number' },
    { key: 'email',              type: 'single_line_text_field',      label: 'Email' },
    { key: 'total_price',        type: 'money',                       label: 'Total Price' },
    { key: 'subtotal_price',     type: 'money',                       label: 'Subtotal Price' },
    { key: 'total_tax',          type: 'money',                       label: 'Total Tax' },
    { key: 'financial_status',   type: 'single_line_text_field',      label: 'Financial Status' },
    { key: 'fulfillment_status', type: 'single_line_text_field',      label: 'Fulfillment Status' },
    { key: 'currency',           type: 'single_line_text_field',      label: 'Currency' },
    { key: 'tags',               type: 'list.single_line_text_field', label: 'Tags' },
    { key: 'note',               type: 'multi_line_text_field',       label: 'Note' }
];

var STANDARD_INVENTORY_FIELDS = [
    { key: 'sku',                     type: 'single_line_text_field', label: 'SKU' },
    { key: 'tracked',                 type: 'boolean',                label: 'Tracked' },
    { key: 'requires_shipping',       type: 'boolean',                label: 'Requires Shipping' },
    { key: 'country_of_origin',       type: 'single_line_text_field', label: 'Country of Origin' },
    { key: 'cost',                    type: 'money',                  label: 'Cost' },
    { key: 'province_code_of_origin', type: 'single_line_text_field', label: 'Province of Origin' }
];

var STANDARD_CUSTOMER_GROUP_FIELDS = [
    { key: 'name',  type: 'single_line_text_field', label: 'Group Name' },
    { key: 'query', type: 'multi_line_text_field',  label: 'Segment Query' }
];

// Standard fields lookup by task name
var TASK_STANDARD_FIELDS = {
    Product:                STANDARD_PRODUCT_FIELDS.concat(STANDARD_VARIANT_FIELDS),
    Category:               STANDARD_CATEGORY_FIELDS,
    Customer:               STANDARD_CUSTOMER_FIELDS,
    Order:                  STANDARD_ORDER_FIELDS,
    ProductInventoryRecord: STANDARD_INVENTORY_FIELDS,
    CustomerGroup:          STANDARD_CUSTOMER_GROUP_FIELDS
};

// Shopify GraphQL metafield owner types per task (empty = standard fields only)
var TASK_OWNER_TYPES = {
    Product:                ['PRODUCT', 'VARIANT'],
    Category:               ['COLLECTION'],
    Customer:               ['CUSTOMER'],
    Order:                  ['ORDER'],
    ProductInventoryRecord: [],
    CustomerGroup:          []
};

var TASK_ORDER = ['Product', 'Category', 'Customer', 'Order', 'ProductInventoryRecord', 'CustomerGroup'];

var TASK_TITLES = {
    Product:                'Product',
    Category:               'Category (Collection)',
    Customer:               'Customer / Profile',
    Order:                  'Order',
    ProductInventoryRecord: 'Inventory Record',
    CustomerGroup:          'Customer Group'
};

function validateCreds(creds) {
    shopifyApi.getCreds(creds);
}

function fmt(n) {
    return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function adminBase(creds) {
    var store   = (creds.storeUrl || '').replace(/\/$/, '');
    if (store && store.indexOf('http') !== 0) { store = 'https://' + store; }
    var version = creds.apiVersion || '2026-07';
    return store + '/admin/api/' + version;
}

function authHeaders(creds) {
    return shopifyApi.authHeaders(creds);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fetchMetafieldDefs(creds, ownerType) {
    var url   = adminBase(creds) + '/graphql.json';
    var query = '{ metafieldDefinitions(ownerType: ' + ownerType + ', first: 250) { nodes { name key namespace type } } }';
    var res   = http.post(url, authHeaders(creds), JSON.stringify({ query: query }));
    if (res.status !== 200 || !res.data || !res.data.data) return [];
    var mfDefs = res.data.data.metafieldDefinitions;
    return (mfDefs && mfDefs.nodes) ? mfDefs.nodes : [];
}

// ─── Connection test ──────────────────────────────────────────────────────────

function testConnectionWith(creds) {
    if (!creds.storeUrl) {
        throw new Error('Store URL is required.');
    }
    shopifyApi.getAccessToken(creds);
    var res = http.get(shopifyApi.adminBase(creds) + '/shop.json', authHeaders(creds));
    if (res.status !== 200 || !res.data.shop) {
        throw new Error('Connection failed (' + res.status + '): check store URL and credentials.');
    }
    var shop = res.data.shop;
    return {
        ok:        true,
        expiresIn: shopifyApi.isDirectToken(creds.clientSecret) ? 0 : 86399,
        project:   { key: shop.myshopify_domain || shop.domain, name: shop.name }
    };
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

    // Count metafield definitions from Shopify GraphQL
    for (var i = 0; i < ownerTypes.length; i++) {
        var ownerType = ownerTypes[i];
        var sfccType  = typeMap.OWNER_TYPE_MAP[ownerType];
        var defs      = fetchMetafieldDefs(c, ownerType);
        if (defs.length) {
            total += defs.length;
            byResource[sfccType] = (byResource[sfccType] || 0) + defs.length;
        }
    }

    // Count all standard fields across all tasks
    var standardTotal = 0;
    for (var ti = 0; ti < TASK_ORDER.length; ti++) {
        standardTotal += (TASK_STANDARD_FIELDS[TASK_ORDER[ti]] || []).length;
    }

    return {
        standardTotal:        standardTotal,
        metafieldDefs:        total,
        byResource:           byResource
    };
}

// ─── Attribute definitions ────────────────────────────────────────────────────

function getAttrDefsForTask(task) {
    var c          = cfg.shopify;
    var stdFields  = TASK_STANDARD_FIELDS[task] || [];
    var ownerTypes = TASK_OWNER_TYPES[task]     || [];
    var seen       = {};
    var defs       = [];

    function push(def) {
        if (!seen[def.id]) { seen[def.id] = true; defs.push(def); }
    }

    for (var sf = 0; sf < stdFields.length; sf++) {
        push(transformer.transformStandardField(stdFields[sf]));
    }

    for (var ot = 0; ot < ownerTypes.length; ot++) {
        var metaDefs = fetchMetafieldDefs(c, ownerTypes[ot]);
        for (var m = 0; m < metaDefs.length; m++) {
            push(transformer.transformMetafieldDef(metaDefs[m]));
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
    var byResource  = counts.byResource  || {};
    var sections    = [];
    var totalFields = 0;

    for (var ti = 0; ti < TASK_ORDER.length; ti++) {
        var task     = TASK_ORDER[ti];
        var stdCount = (TASK_STANDARD_FIELDS[task] || []).length;
        var mfCount  = byResource[task] || 0;
        totalFields += stdCount + mfCount;

        var items = ['Standard fields'];
        if (mfCount) items.push('Metafield definitions (' + fmt(mfCount) + ')');

        sections.push({ taskId: task, title: TASK_TITLES[task], items: items, selectable: true });
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
    var c          = cfg.shopify;
    validateCreds(c);
    var existing   = existingByTask || {};
    var groups     = [];
    var totalAttrs = 0;

    for (var ti = 0; ti < TASK_ORDER.length; ti++) {
        var task       = TASK_ORDER[ti];
        if (selectedTasks && selectedTasks.indexOf(task) < 0) continue;

        var mappings   = [];
        var seen       = {};
        var stdFields  = TASK_STANDARD_FIELDS[task] || [];
        var ownerTypes = TASK_OWNER_TYPES[task]     || [];

        // Standard fields
        for (var sf = 0; sf < stdFields.length; sf++) {
            var std     = stdFields[sf];
            var sKey    = task + '__' + std.key;
            if (seen[sKey]) continue;
            seen[sKey] = true;
            totalAttrs++;
            var stdRule   = nativeFieldMap.getRule('shopify', task, std.key);
            var stdMapping = {
                source:      std.key + ' (' + std.type + ')',
                attributeId: std.key,
                target:      typeMap.resolveMetafieldType(std.type),
                confidence:  typeMap.confidence(std.type),
                exists:      !!(existing[task] && existing[task][std.key])
            };
            if (stdRule) {
                stdMapping.sfccNativeField  = stdRule.sfccField;
                stdMapping.sfccNativeNote   = stdRule.note;
                stdMapping.sfccNativeAction = stdRule.action;
            }
            mappings.push(stdMapping);
        }

        // Metafield definitions from Shopify GraphQL
        for (var ot = 0; ot < ownerTypes.length; ot++) {
            var defs = fetchMetafieldDefs(c, ownerTypes[ot]);
            totalAttrs += defs.length;
            for (var di = 0; di < defs.length; di++) {
                var def    = defs[di];
                var mfId   = (def.namespace ? def.namespace + '__' + def.key : def.key).replace(/[^a-zA-Z0-9_]/g, '_');
                var mfType = def.type && typeof def.type === 'object' ? def.type.name : (String(def.type || 'single_line_text_field'));
                var mfKey  = task + '__' + mfId;
                if (seen[mfKey]) continue;
                seen[mfKey] = true;
                mappings.push({
                    source:      def.namespace + '.' + def.key + ' (' + mfType + ')',
                    attributeId: mfId,
                    target:      typeMap.resolveMetafieldType(mfType),
                    confidence:  typeMap.confidence(mfType),
                    exists:      !!(existing[task] && existing[task][mfId])
                });
            }
        }

        if (mappings.length) groups.push(toGroup(TASK_TITLES[task], mappings));
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
        if (field.name === 'storeUrl')                            value = s.storeUrl   || value;
        else if (field.name === 'clientId')                       value = s.clientId   || value;
        else if (field.name === 'clientSecret' && s.clientSecret) value = '••••••••';
        else if (field.name === 'apiVersion')                     value = s.apiVersion || value;
        out.push({ name: field.name, label: field.label, type: field.type, required: field.required, value: value, placeholder: field.placeholder || '' });
    }
    return out;
}

// ─── Default tasks ────────────────────────────────────────────────────────────

function getDefaultTasks() {
    return TASK_ORDER.slice();
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
