'use strict';

var sfccClient = require('*/cartridge/scripts/migration/sfccClient');

/**
 * Maps runner task names to their SFCC system object equivalents.
 * Defined once here; exported so Accelerator.js can reuse for existing-attr lookups.
 */
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
 * Migrate one batch of attributes for a single task using any registered connector.
 * Stays within the SFCC 16 HTTP-calls-per-request quota:
 *   1  getSFCCToken
 *   ~2 connector.getAttrDefsForTask  (auth + schema fetch)
 *   10 createAttributeDefinition (max batch size)
 *
 * @param {Object} connector  - platform connector from registry.get(platformId)
 * @param {string} task       - runner task name (Product, Customer, …)
 * @param {number} offset     - start index within the full attr list
 * @param {number} limit      - max attrs to create this call (default 10)
 * @returns {Object} { ok, task, total, nextOffset, created, failed, done, errors }
 */
function runBatch(connector, task, offset, limit) {
    var sfccObject = TASK_SFCC_OBJECT[task];
    if (!sfccObject) return { ok: false, error: 'Unknown task: ' + task };

    var batchLimit = limit || 10;
    var sfccToken  = sfccClient.getSFCCToken();        // 1 HTTP call
    var allDefs    = connector.getAttrDefsForTask(task); // connector auth + schema fetch
    var batch      = allDefs.slice(offset, offset + batchLimit);
    var created    = 0;
    var failed     = 0;
    var errors     = [];

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
 * Delete one batch of source-schema attributes from an SFCC system object.
 * @param {Object} connector - platform connector
 * @param {string} task
 * @param {number} offset
 * @param {number} limit
 * @returns {Object} { ok, task, total, nextOffset, deleted, failed, done }
 */
function deleteBatch(connector, task, offset, limit) {
    var sfccObject = TASK_SFCC_OBJECT[task];
    if (!sfccObject) return { ok: false, error: 'Unknown task: ' + task };

    var batchLimit = limit || 10;
    var sfccToken  = sfccClient.getSFCCToken();
    var allIds     = connector.getAttrIdsForTask(task);
    var batch      = allIds.slice(offset, offset + batchLimit);
    var deleted    = 0;
    var failed     = 0;

    for (var i = 0; i < batch.length; i++) {
        try {
            sfccClient.deleteAttributeDefinition(sfccToken, sfccObject, batch[i]);
            deleted++;
        } catch (e) {
            failed++;
        }
    }

    var nextOffset = offset + batch.length;
    return {
        ok:         true,
        task:       task,
        total:      allIds.length,
        nextOffset: nextOffset,
        deleted:    deleted,
        failed:     failed,
        done:       nextOffset >= allIds.length
    };
}

module.exports = {
    runBatch:          runBatch,
    deleteBatch:       deleteBatch,
    TASK_SFCC_OBJECT:  TASK_SFCC_OBJECT
};
