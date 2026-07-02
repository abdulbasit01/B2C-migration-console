'use strict';

var ctpOrderConnector  = require('*/cartridge/scripts/migration/orders/connectors/ctpOrderConnector');
var ctpOrderMapper     = require('*/cartridge/scripts/migration/orders/mappers/ctpOrderMapper');
var orderValidator     = require('*/cartridge/scripts/migration/orders/validators/orderValidator');
var sfccOrderXmlGen    = require('*/cartridge/scripts/migration/orders/generators/sfccOrderXmlGenerator');
var impexGenerator     = require('*/cartridge/scripts/migration/orders/generators/impexGenerator');

/**
 * Run the full order migration pipeline.
 * @param {Object} options
 * @param {number} options.years - 1, 2, or 3
 * @param {number} [options.maxCount] - optional max orders
 * @param {string} [options.orderState] - commercetools orderState filter
 * @param {string} [options.paymentState] - commercetools paymentState filter
 * @param {number} [options.chunkSize] - orders per XML file (default 5000)
 * @returns {Object} migration report
 */
function run(options) {
    var years     = parseInt(String(options.years || 1), 10);
    var maxCount  = options.maxCount ? parseInt(String(options.maxCount), 10) : null;
    var chunkSize = options.chunkSize || sfccOrderXmlGen.DEFAULT_CHUNK_SIZE;

    var rawOrders = ctpOrderConnector.fetchOrdersByDateRange({
        years:        years,
        maxCount:     maxCount,
        orderState:   options.orderState || '',
        paymentState: options.paymentState || ''
    });

    var ordersProcessed = rawOrders.length;
    var canonical       = ctpOrderMapper.mapOrders(rawOrders);
    var validation      = orderValidator.validateOrders(canonical);

    var validOrders = [];
    for (var i = 0; i < canonical.length; i++) {
        if (validation.results[i].valid) {
            validOrders.push(canonical[i]);
        }
    }

    var xmlChunks = sfccOrderXmlGen.generateChunkedXml(validOrders, chunkSize);
    var pkg = impexGenerator.generatePackage(xmlChunks);

    return {
        ordersProcessed:    ordersProcessed,
        ordersValidated:    validation.valid,
        ordersFailed:       validation.failed,
        xmlFilesGenerated:  xmlChunks.length,
        runId:              pkg.runDate,
        impexPath:          pkg.impexPath,
        validationReport:   validation
    };
}

module.exports = {
    run: run
};
