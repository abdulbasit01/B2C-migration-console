'use strict';

var bigcommerceApi = require('*/cartridge/scripts/migration/core/bigcommerceApi');
var typeMap        = require('*/cartridge/scripts/migration/connectors/bigcommerce/bigcommerceTypeMap');
var transformer    = require('*/cartridge/scripts/migration/connectors/bigcommerce/bigcommerceTransformer');
var cfg            = require('*/cartridge/scripts/migration/configAccessor');
var nativeFieldMap = require('*/cartridge/scripts/migration/config/nativeFieldMap');

var STANDARD_PRODUCT_FIELDS = [
    { key: 'name',              type: 'single_line_text_field', label: 'Name' },
    { key: 'sku',               type: 'single_line_text_field', label: 'SKU' },
    { key: 'description',       type: 'multi_line_text_field',  label: 'Description' },
    { key: 'price',             type: 'money',                  label: 'Price' },
    { key: 'sale_price',        type: 'money',                  label: 'Sale Price' },
    { key: 'cost_price',        type: 'money',                  label: 'Cost Price' },
    { key: 'weight',            type: 'number_decimal',         label: 'Weight' },
    { key: 'type',              type: 'single_line_text_field', label: 'Type' },
    { key: 'brand_id',          type: 'number_integer',         label: 'Brand ID' },
    { key: 'is_visible',        type: 'boolean',                label: 'Visible' },
    { key: 'is_featured',       type: 'boolean',                label: 'Featured' },
    { key: 'inventory_tracking', type: 'single_line_text_field', label: 'Inventory Tracking' }
];

var STANDARD_VARIANT_FIELDS = [
    { key: 'variant_sku',    type: 'single_line_text_field', label: 'Variant SKU' },
    { key: 'variant_price',  type: 'money',                  label: 'Variant Price' },
    { key: 'variant_weight', type: 'number_decimal',         label: 'Variant Weight' },
    { key: 'variant_upc',    type: 'single_line_text_field', label: 'UPC' }
];

var STANDARD_CATEGORY_FIELDS = [
    { key: 'name',             type: 'single_line_text_field', label: 'Name' },
    { key: 'description',      type: 'multi_line_text_field',  label: 'Description' },
    { key: 'parent_id',        type: 'number_integer',         label: 'Parent ID' },
    { key: 'sort_order',       type: 'number_integer',         label: 'Sort Order' },
    { key: 'is_visible',       type: 'boolean',                label: 'Visible' },
    { key: 'page_title',       type: 'single_line_text_field', label: 'Page Title' },
    { key: 'meta_description', type: 'multi_line_text_field',  label: 'Meta Description' }
];

var STANDARD_CUSTOMER_FIELDS = [
    { key: 'email',              type: 'email',                 label: 'Email' },
    { key: 'first_name',         type: 'single_line_text_field', label: 'First Name' },
    { key: 'last_name',          type: 'single_line_text_field', label: 'Last Name' },
    { key: 'phone',              type: 'phone',                  label: 'Phone' },
    { key: 'company',            type: 'single_line_text_field', label: 'Company' },
    { key: 'customer_group_id',  type: 'number_integer',         label: 'Customer Group ID' },
    { key: 'notes',              type: 'multi_line_text_field',  label: 'Notes' },
    { key: 'tax_exempt_category', type: 'single_line_text_field', label: 'Tax Exempt Category' }
];

var STANDARD_ORDER_FIELDS = [
    { key: 'id',                 type: 'number_integer',         label: 'Order ID' },
    { key: 'status',             type: 'single_line_text_field', label: 'Status' },
    { key: 'payment_status',     type: 'single_line_text_field', label: 'Payment Status' },
    { key: 'customer_id',        type: 'number_integer',         label: 'Customer ID' },
    { key: 'subtotal_ex_tax',    type: 'money',                  label: 'Subtotal Ex Tax' },
    { key: 'subtotal_inc_tax',   type: 'money',                  label: 'Subtotal Inc Tax' },
    { key: 'total_inc_tax',      type: 'money',                  label: 'Total Inc Tax' },
    { key: 'total_tax',          type: 'money',                  label: 'Total Tax' },
    { key: 'currency_code',      type: 'single_line_text_field', label: 'Currency' },
    { key: 'staff_notes',        type: 'multi_line_text_field',  label: 'Staff Notes' },
    { key: 'customer_message',   type: 'multi_line_text_field',  label: 'Customer Message' }
];

var STANDARD_INVENTORY_FIELDS = [
    { key: 'sku',                type: 'single_line_text_field', label: 'SKU' },
    { key: 'identity',           type: 'single_line_text_field', label: 'Identity' },
    { key: 'available_to_sell',  type: 'number_integer',         label: 'Available To Sell' },
    { key: 'total_inventory_onhand', type: 'number_integer',     label: 'On Hand' },
    { key: 'location_id',        type: 'number_integer',         label: 'Location ID' }
];

var STANDARD_CUSTOMER_GROUP_FIELDS = [
    { key: 'name',         type: 'single_line_text_field', label: 'Group Name' },
    { key: 'is_default',   type: 'boolean',                label: 'Is Default' },
    { key: 'category_access', type: 'single_line_text_field', label: 'Category Access' }
];

var TASK_STANDARD_FIELDS = {
    Product:                STANDARD_PRODUCT_FIELDS.concat(STANDARD_VARIANT_FIELDS),
    Category:               STANDARD_CATEGORY_FIELDS,
    Customer:               STANDARD_CUSTOMER_FIELDS,
    Order:                  STANDARD_ORDER_FIELDS,
    ProductInventoryRecord: STANDARD_INVENTORY_FIELDS,
    CustomerGroup:          STANDARD_CUSTOMER_GROUP_FIELDS
};

var TASK_ORDER = ['Product', 'Category', 'Customer', 'Order', 'ProductInventoryRecord', 'CustomerGroup'];

var TASK_TITLES = {
    Product:                'Product',
    Category:               'Category',
    Customer:               'Customer / Profile',
    Order:                  'Order',
    ProductInventoryRecord: 'Inventory Record',
    CustomerGroup:          'Customer Group'
};

function validateCreds(creds) {
    bigcommerceApi.getCreds(creds);
}

function fmt(n) {
    return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function authHeaders(creds) {
    return bigcommerceApi.authHeaders(creds);
}

function adminBase(creds) {
    return bigcommerceApi.getBaseUrl(creds, 'v3');
}

/**
 * Sample product custom field names for schema discovery (best-effort).
 * @param {Object} creds
 * @returns {Array}
 */
function fetchSampleCustomFields(creds) {
    try {
        var page = bigcommerceApi.fetchPage('/catalog/products', 0, 25, creds, {
            version:     'v3',
            queryParams: 'include=custom_fields'
        });
        var seen = {};
        var out  = [];
        var i;
        var j;
        for (i = 0; i < page.results.length; i++) {
            var cfs = page.results[i].custom_fields || [];
            for (j = 0; j < cfs.length; j++) {
                var name = cfs[j].name;
                if (!name || seen[name]) continue;
                seen[name] = true;
                out.push({ key: name, type: 'string', label: name, name: name });
            }
        }
        return out;
    } catch (e) {
        return [];
    }
}

function testConnectionWith(creds) {
    if (!creds.storeHash) {
        throw new Error('Store hash is required.');
    }
    if (!creds.accessToken) {
        throw new Error('Access token is required.');
    }
    var store = bigcommerceApi.getStore(creds);
    return {
        ok:        true,
        expiresIn: 0,
        project:   {
            key:  creds.storeHash,
            name: store.name || store.domain || creds.storeHash
        }
    };
}

function testConnection() {
    return testConnectionWith(cfg.bigcommerce || {});
}

function getSchemaCounts() {
    var c = cfg.bigcommerce || {};
    validateCreds(c);
    var customFields = fetchSampleCustomFields(c);
    var standardTotal = 0;
    var ti;
    for (ti = 0; ti < TASK_ORDER.length; ti++) {
        standardTotal += (TASK_STANDARD_FIELDS[TASK_ORDER[ti]] || []).length;
    }
    return {
        standardTotal: standardTotal,
        metafieldDefs: customFields.length,
        byResource:    customFields.length ? { Product: customFields.length } : {}
    };
}

function getAttrDefsForTask(task) {
    var c         = cfg.bigcommerce || {};
    var stdFields = TASK_STANDARD_FIELDS[task] || [];
    var seen      = {};
    var defs      = [];

    function push(def) {
        if (!seen[def.id]) {
            seen[def.id] = true;
            defs.push(def);
        }
    }

    var sf;
    for (sf = 0; sf < stdFields.length; sf++) {
        push(transformer.transformStandardField(stdFields[sf]));
    }

    if (task === 'Product') {
        var customFields = fetchSampleCustomFields(c);
        var ci;
        for (ci = 0; ci < customFields.length; ci++) {
            push(transformer.transformCustomField(customFields[ci]));
        }
    }

    return defs;
}

function getAttrIdsForTask(task) {
    var defs = getAttrDefsForTask(task);
    var ids  = [];
    var i;
    for (i = 0; i < defs.length; i++) ids.push(defs[i].id);
    return ids;
}

function buildFetchContent(counts) {
    var byResource  = counts.byResource || {};
    var sections    = [];
    var totalFields = 0;
    var ti;

    for (ti = 0; ti < TASK_ORDER.length; ti++) {
        var task     = TASK_ORDER[ti];
        var stdCount = (TASK_STANDARD_FIELDS[task] || []).length;
        var cfCount  = byResource[task] || 0;
        totalFields += stdCount + cfCount;

        var items = ['Standard fields'];
        if (cfCount) items.push('Custom fields (' + fmt(cfCount) + ')');

        sections.push({
            taskId:     task,
            title:      TASK_TITLES[task],
            items:      items,
            selectable: true
        });
    }

    return {
        titleSuffix: 'Select schemas to migrate',
        intro:       'Standard BigCommerce fields are always included. Product custom fields are sampled live when available.',
        sections:    sections,
        summary:     'Total schema definitions: ' + fmt(totalFields)
    };
}

function toGroup(title, mappings) {
    var existsCount = 0;
    var i;
    for (i = 0; i < mappings.length; i++) {
        if (mappings[i].exists) existsCount++;
    }
    return {
        title:       title,
        total:       mappings.length,
        existsCount: existsCount,
        newCount:    mappings.length - existsCount,
        mappings:    mappings
    };
}

function buildAiMapContent(selectedTasks, existingByTask) {
    var c        = cfg.bigcommerce || {};
    validateCreds(c);
    var existing = existingByTask || {};
    var groups   = [];
    var totalAttrs = 0;
    var ti;

    for (ti = 0; ti < TASK_ORDER.length; ti++) {
        var task = TASK_ORDER[ti];
        if (selectedTasks && selectedTasks.indexOf(task) < 0) continue;

        var mappings  = [];
        var seen      = {};
        var stdFields = TASK_STANDARD_FIELDS[task] || [];
        var sf;

        for (sf = 0; sf < stdFields.length; sf++) {
            var std  = stdFields[sf];
            var sKey = task + '__' + std.key;
            if (seen[sKey]) continue;
            seen[sKey] = true;
            totalAttrs++;
            var stdRule = nativeFieldMap.getRule('bigcommerce', task, std.key);
            var stdMapping = {
                source:      std.key + ' (' + std.type + ')',
                attributeId: std.key,
                target:      typeMap.resolveFieldType(std.type),
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

        if (task === 'Product') {
            var customFields = fetchSampleCustomFields(c);
            var ci;
            for (ci = 0; ci < customFields.length; ci++) {
                var cf   = customFields[ci];
                var cfId = String(cf.key || cf.name).replace(/[^a-zA-Z0-9_]/g, '_');
                var cfKey = task + '__' + cfId;
                if (seen[cfKey]) continue;
                seen[cfKey] = true;
                totalAttrs++;
                mappings.push({
                    source:      cf.name + ' (custom_field)',
                    attributeId: cfId,
                    target:      'string',
                    confidence:  90,
                    exists:      !!(existing[task] && existing[task][cfId])
                });
            }
        }

        if (mappings.length) groups.push(toGroup(TASK_TITLES[task], mappings));
    }

    return {
        titleSuffix: 'Schema field mapping',
        intro:       'BigCommerce field → SFCC value_type mappings. ' + totalAttrs + ' total attribute(s) across ' + groups.length + ' entity type(s).',
        groups:      groups
    };
}

function injectCredentials(fields) {
    var s   = cfg.bigcommerce || {};
    var out = [];
    var i;
    for (i = 0; i < fields.length; i++) {
        var field = fields[i];
        var value = field.value;
        if (field.name === 'storeHash') value = s.storeHash || value;
        else if (field.name === 'clientId') value = s.clientId || value;
        else if (field.name === 'accessToken' && s.accessToken) value = '••••••••';
        else if (field.name === 'apiVersion') value = s.apiVersion || value;
        out.push({
            name:        field.name,
            label:       field.label,
            type:        field.type,
            required:    field.required,
            value:       value,
            placeholder: field.placeholder || ''
        });
    }
    return out;
}

function getDefaultTasks() {
    return TASK_ORDER.slice();
}

module.exports = {
    id:                 'bigcommerce',
    testConnectionWith: testConnectionWith,
    testConnection:     testConnection,
    getSchemaCounts:    getSchemaCounts,
    getAttrDefsForTask: getAttrDefsForTask,
    getAttrIdsForTask:  getAttrIdsForTask,
    injectCredentials:  injectCredentials,
    getDefaultTasks:    getDefaultTasks,
    buildFetchContent:  buildFetchContent,
    buildAiMapContent:  buildAiMapContent,
    getAuthHeaders:     authHeaders,
    getAdminBase:       adminBase
};
