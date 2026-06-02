'use strict';

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

module.exports = {
    runAll:               runAll,
    migrateProductSchema: migrateProductSchema,
    migrateCustomTypeSchema: migrateCustomTypeSchema
};
