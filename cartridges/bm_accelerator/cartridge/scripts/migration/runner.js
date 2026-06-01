'use strict';

var ctpClient = require('*/cartridge/scripts/migration/ctpClient');
var sfccClient = require('*/cartridge/scripts/migration/sfccClient');
var transformers = require('*/cartridge/scripts/migration/transformers');
var cfg = require('*/cartridge/scripts/migration/config');

/**
 * Run a batch of items through a process function.
 * Returns { success, failed, errors[] }
 */
function runBatch(items, processFn) {
    var results = { success: 0, failed: 0, errors: [] };
    for (var i = 0; i < items.length; i++) {
        try {
            processFn(items[i]);
            results.success++;
        } catch (e) {
            results.failed++;
            results.errors.push(e.message || String(e));
        }
    }
    return results;
}

/**
 * Migrate categories from CTP → SFCC.
 */
function migrateCategories() {
    var ctpToken = ctpClient.getCTPToken();
    var sfccToken = sfccClient.getSFCCToken();

    var raw = ctpClient.fetchAll(ctpToken, '/categories', null);
    var categories = [];
    for (var i = 0; i < raw.length; i++) {
        categories.push(transformers.transformCategory(raw[i]));
    }

    return runBatch(categories, function (cat) {
        sfccClient.upsertCategory(sfccToken, cat);
    });
}

/**
 * Migrate products from CTP → SFCC (with optional key filter).
 */
function migrateProducts(filterKey) {
    var ctpToken = ctpClient.getCTPToken();
    var sfccToken = sfccClient.getSFCCToken();

    var extraParams = filterKey ? { where: 'key="' + filterKey + '"', limit: '1' } : { expand: 'productType' };
    var raw = filterKey
        ? ctpClient.fetchAll(ctpToken, '/products', { where: 'key="' + filterKey + '"', limit: '1' })
        : ctpClient.fetchAll(ctpToken, '/products', { expand: 'productType' });

    var products = [];
    for (var i = 0; i < raw.length; i++) {
        products.push(transformers.transformProduct(raw[i]));
    }

    if (!cfg.migration.dryRun) {
        sfccClient.ensureAttributes(sfccToken, 'Product', products);
    }

    return runBatch(products, function (product) {
        sfccClient.upsertProduct(sfccToken, product);
    });
}

/**
 * Migrate customers from CTP → SFCC.
 */
function migrateCustomers() {
    var ctpToken = ctpClient.getCTPToken();
    var sfccToken = sfccClient.getSFCCToken();

    var raw = ctpClient.fetchAll(ctpToken, '/customers', null);
    var customers = [];
    for (var i = 0; i < raw.length; i++) {
        var c = transformers.transformCustomer(raw[i]);
        if (c.email) customers.push(c);
    }

    if (!cfg.migration.dryRun) {
        sfccClient.ensureAttributes(sfccToken, 'Customer', customers);
    }

    return runBatch(customers, function (customer) {
        sfccClient.upsertCustomer(sfccToken, customer);
    });
}

/**
 * Migrate inventory from CTP → SFCC.
 */
function migrateInventory() {
    var ctpToken = ctpClient.getCTPToken();
    var sfccToken = sfccClient.getSFCCToken();

    var raw = ctpClient.fetchAll(ctpToken, '/inventory', null);
    var records = [];
    for (var i = 0; i < raw.length; i++) {
        records.push(transformers.transformInventory(raw[i]));
    }

    return runBatch(records, function (record) {
        sfccClient.upsertInventory(sfccToken, record);
    });
}

/**
 * Run all migration tasks.
 * Returns { categories, products, customers, inventory } each with { success, failed }
 */
function runAll(tasks) {
    var results = {};
    var taskList = tasks || ['categories', 'products', 'customers', 'inventory'];
    var taskMap = {
        categories: migrateCategories,
        products:   migrateProducts,
        customers:  migrateCustomers,
        inventory:  migrateInventory
    };

    for (var i = 0; i < taskList.length; i++) {
        var task = taskList[i];
        if (!taskMap[task]) continue;
        try {
            results[task] = taskMap[task]();
        } catch (e) {
            results[task] = { success: 0, failed: 0, error: e.message || String(e) };
        }
    }
    return results;
}

module.exports = {
    runAll: runAll,
    migrateCategories: migrateCategories,
    migrateProducts: migrateProducts,
    migrateCustomers: migrateCustomers,
    migrateInventory: migrateInventory
};
