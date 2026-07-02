'use strict';

var fullMigrationRunner = require('*/cartridge/scripts/migration/orders/fullMigrationRunner');

/**
 * Run the full order migration pipeline (streaming single-file export).
 * @param {Object} options
 * @param {number} options.years - 1, 2, or 3
 * @param {number} [options.maxCount] - optional max orders
 * @param {string} [options.orderState] - commercetools orderState filter
 * @param {string} [options.paymentState] - commercetools paymentState filter
 * @returns {Object} migration report
 */
function run(options) {
    var result = fullMigrationRunner.runBatch(0, options, true);
    if (!result.ok) {
        throw new Error(result.error || 'Order migration failed');
    }

    return {
        ordersProcessed:   result.ordersProcessed,
        ordersValidated:   result.ordersValidated,
        ordersFailed:      result.ordersFailed,
        xmlFilesGenerated: result.xmlFilesGenerated,
        runId:             result.runId,
        impexPath:         result.impexPath,
        fileName:          result.fileName
    };
}

module.exports = {
    run: run
};
