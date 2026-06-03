'use strict';

/* global session */

var ctpClient    = require('*/cartridge/scripts/migration/ctpClient');
var sfccClient   = require('*/cartridge/scripts/migration/sfccClient');
var transformers = require('*/cartridge/scripts/migration/transformers');
var typeMap      = require('*/cartridge/scripts/migration/typeMap');

/**
 * Migrate schema for a single SFCC object type using CTP ProductType attributes.
 * @param {string} sfccObjectType - SFCC system object (e.g. 'Product')
 * @param {Array} attrDefs - transformed attribute definitions
 * @param {string} token - SFCC token
 * @returns {Object} { success, failed } for runner compatibility
 */
function runSchemaGroup(sfccObjectType, attrDefs, token) {
    if (!attrDefs.length) {
        return { success: 0, failed: 0 };
    }
    var result = sfccClient.migrateObjectSchema(token, sfccObjectType, attrDefs);
    return { success: result.created + result.skipped, failed: result.failed };
}

// ─── Schema runners ───────────────────────────────────────────────────────────

/**
 * Migrate Product schema: reads CTP ProductType attribute definitions.
 * @returns {Object} { success, failed }
 */
function migrateProductSchema() {
    var ctpToken   = ctpClient.getCTPToken();
    var sfccToken  = sfccClient.getSFCCToken();
    var types      = ctpClient.fetchProductTypes(ctpToken);
    var attrDefs   = [];
    var seen       = {};

    for (var i = 0; i < types.length; i++) {
        var attrs = types[i].attributes || [];
        for (var j = 0; j < attrs.length; j++) {
            var def = transformers.transformProductTypeAttr(attrs[j]);
            if (!seen[def.id]) {
                seen[def.id] = true;
                attrDefs.push(def);
            }
        }
    }

    return runSchemaGroup('Product', attrDefs, sfccToken);
}

/**
 * Migrate schema for a given SFCC object type from CTP Custom Types.
 * @param {string} sfccObjectType - SFCC system object type
 * @param {string} ctpToken - CTP token
 * @param {string} sfccToken - SFCC token
 * @param {Array} customTypes - all CTP custom types
 * @returns {Object} { success, failed }
 */
function migrateCustomTypeSchema(sfccObjectType, ctpToken, sfccToken, customTypes) {
    var attrDefs = [];
    var seen     = {};

    for (var i = 0; i < customTypes.length; i++) {
        var resourceTypeIds = customTypes[i].resourceTypeIds || [];
        var fields          = customTypes[i].fieldDefinitions || [];
        var applies         = false;

        for (var r = 0; r < resourceTypeIds.length; r++) {
            if (typeMap.resolveSFCCObjectType(resourceTypeIds[r]) === sfccObjectType) {
                applies = true;
                break;
            }
        }

        if (!applies) continue;

        for (var j = 0; j < fields.length; j++) {
            var def = transformers.transformCustomTypeField(fields[j]);
            if (!seen[def.id]) {
                seen[def.id] = true;
                attrDefs.push(def);
            }
        }
    }

    return runSchemaGroup(sfccObjectType, attrDefs, sfccToken);
}

/**
 * Run all schema migrations.
 * Covers: Product, Category, Customer, Order, ProductInventoryRecord,
 *         ProductList, ProductListItem, Promotion.
 * @param {Array} tasks - optional list of task names to run
 * @returns {Object} results per SFCC object type
 */
function runAll(tasks) {
    var ctpToken     = ctpClient.getCTPToken();
    var sfccToken    = sfccClient.getSFCCToken();
    var customTypes  = ctpClient.fetchCustomTypes(ctpToken);

    var SCHEMA_TASKS = {
        Product:                 function () { return migrateProductSchema(); },
        Category:                function () { return migrateCustomTypeSchema('Category', ctpToken, sfccToken, customTypes); },
        Customer:                function () { return migrateCustomTypeSchema('Customer', ctpToken, sfccToken, customTypes); },
        Order:                   function () { return migrateCustomTypeSchema('Order', ctpToken, sfccToken, customTypes); },
        ProductInventoryRecord:  function () { return migrateCustomTypeSchema('ProductInventoryRecord', ctpToken, sfccToken, customTypes); },
        ProductList:             function () { return migrateCustomTypeSchema('ProductList', ctpToken, sfccToken, customTypes); },
        ProductListItem:         function () { return migrateCustomTypeSchema('ProductListItem', ctpToken, sfccToken, customTypes); },
        Promotion:               function () { return migrateCustomTypeSchema('Promotion', ctpToken, sfccToken, customTypes); }
    };

    var taskList = tasks || Object.keys(SCHEMA_TASKS);
    var results  = {};

    for (var i = 0; i < taskList.length; i++) {
        var task = taskList[i];
        if (!SCHEMA_TASKS[task]) continue;
        try {
            results[task] = SCHEMA_TASKS[task]();
        } catch (e) {
            results[task] = { success: 0, failed: 0, error: e.message || String(e) };
        }
    }
    return results;
}

var TASK_SFCC_OBJECT = {
    Product:                'Product',
    Category:               'Category',
    Customer:               'Customer',
    Order:                  'Order',
    ProductInventoryRecord: 'ProductInventoryRecord',
    ProductList:            'ProductList',
    ProductListItem:        'ProductListItem',
    Promotion:              'Promotion'
};

/**
 * Build deduped attribute definitions for one runner task.
 * @param {string} task       - runner task name (Product, Customer, etc.)
 * @param {string} ctpToken   - CTP access token
 * @param {Array}  customTypes - pre-fetched CTP custom types (pass null to fetch)
 * @returns {Array} SFCC attribute definition objects
 */
function getAttrDefsForTask(task, ctpToken, customTypes) {
    var seen = {};

    if (task === 'Product') {
        var types     = ctpClient.fetchProductTypes(ctpToken);
        var custTypes = customTypes || ctpClient.fetchCustomTypes(ctpToken);
        var attrDefs  = [];
        var i;
        var j;

        for (i = 0; i < types.length; i++) {
            var attrs = types[i].attributes || [];
            for (j = 0; j < attrs.length; j++) {
                var def = transformers.transformProductTypeAttr(attrs[j]);
                if (!seen[def.id]) { seen[def.id] = true; attrDefs.push(def); }
            }
        }

        // Also include custom type fields mapped to Product (product-price, product-variant, etc.)
        var PRODUCT_RESOURCES = ['product', 'product-variant', 'product-price'];
        for (i = 0; i < custTypes.length; i++) {
            var ct    = custTypes[i];
            var rids  = ct.resourceTypeIds || [];
            var flds  = ct.fieldDefinitions || [];
            var match = false;
            for (j = 0; j < rids.length; j++) {
                if (PRODUCT_RESOURCES.indexOf(rids[j]) >= 0) { match = true; break; }
            }
            if (!match) continue;
            for (j = 0; j < flds.length; j++) {
                var fdef = transformers.transformCustomTypeField(flds[j]);
                if (!seen[fdef.id]) { seen[fdef.id] = true; attrDefs.push(fdef); }
            }
        }

        return attrDefs;
    }

    var sfccObject  = TASK_SFCC_OBJECT[task];
    var cts         = customTypes || ctpClient.fetchCustomTypes(ctpToken);
    var customDefs  = [];
    for (var ci = 0; ci < cts.length; ci++) {
        var resourceTypeIds = cts[ci].resourceTypeIds || [];
        var fields          = cts[ci].fieldDefinitions || [];
        var applies         = false;
        for (var r = 0; r < resourceTypeIds.length; r++) {
            if (typeMap.resolveSFCCObjectType(resourceTypeIds[r]) === sfccObject) { applies = true; break; }
        }
        if (!applies) continue;
        for (var fi = 0; fi < fields.length; fi++) {
            var fdef = transformers.transformCustomTypeField(fields[fi]);
            if (!seen[fdef.id]) { seen[fdef.id] = true; customDefs.push(fdef); }
        }
    }
    return customDefs;
}

/**
 * Migrate one batch of NEW (not yet existing) attributes for a single task.
 * Reads pre-fetched existing attr IDs from session (set by GetExistingAttrs endpoint).
 * Stays within the SFCC 16 HTTP-calls-per-request quota.
 * @param {string} task   - runner task name
 * @param {number} offset - start index within the NEW-only attr list
 * @param {number} limit  - max attrs to create this call (default 10)
 * @returns {Object} { ok, task, total, skipped, nextOffset, created, failed, done, errors }
 */
function runBatch(task, offset, limit) {
    var batchLimit = limit || 10;
    var sfccObject = TASK_SFCC_OBJECT[task];
    if (!sfccObject) return { ok: false, error: 'Unknown task: ' + task };

    var ctpToken  = ctpClient.getCTPToken();   // 1 HTTP call
    var sfccToken = sfccClient.getSFCCToken(); // 1 HTTP call
    var allDefs   = getAttrDefsForTask(task, ctpToken, null); // 2 HTTP calls (Product: fetchProductTypes + fetchCustomTypes)

    // Idempotent PUT — SFCC returns 200 for both create and update; no pre-check needed.
    // Existing count is provided separately by GetExistingAttrs (its own request/quota).
    var batch   = allDefs.slice(offset, offset + batchLimit);
    var created = 0;
    var failed  = 0;
    var errors  = [];

    for (var i = 0; i < batch.length; i++) {
        try {
            sfccClient.createAttributeDefinition(sfccToken, sfccObject, batch[i]); // 1 HTTP call each
            created++;
        } catch (e) {
            failed++;
            if (errors.length < 3) errors.push(batch[i].id + ': ' + (e.message || String(e)));
        }
    }

    var nextOffset = offset + batch.length;
    return {
        ok:         true,
        task:       task,
        total:      allDefs.length,
        nextOffset: nextOffset,
        created:    created,
        failed:     failed,
        done:       nextOffset >= allDefs.length,
        errors:     errors
    };
}

/**
 * Return only the IDs (not full defs) for a given task — used for deletion.
 * @param {string} task     - runner task name
 * @param {string} ctpToken - CTP access token
 * @returns {Array} attribute ID strings
 */
function getAttrIdsForTask(task, ctpToken) {
    var defs = getAttrDefsForTask(task, ctpToken, null);
    var ids  = [];
    for (var i = 0; i < defs.length; i++) ids.push(defs[i].id);
    return ids;
}

module.exports = {
    runAll:               runAll,
    runBatch:             runBatch,
    getAttrDefsForTask:   getAttrDefsForTask,
    getAttrIdsForTask:    getAttrIdsForTask,
    migrateProductSchema: migrateProductSchema,
    migrateCustomTypeSchema: migrateCustomTypeSchema
};
