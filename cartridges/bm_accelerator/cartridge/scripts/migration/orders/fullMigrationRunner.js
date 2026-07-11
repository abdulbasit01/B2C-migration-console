'use strict';

var File       = require('dw/io/File');
var FileWriter = require('dw/io/FileWriter');
var connector  = require('*/cartridge/scripts/migration/orders/connectors/ctpOrderConnector');
var mapper     = require('*/cartridge/scripts/migration/orders/mappers/ctpOrderMapper');
var validator  = require('*/cartridge/scripts/migration/orders/validators/orderValidator');
var xmlGen     = require('*/cartridge/scripts/migration/orders/generators/sfccOrderXmlGenerator');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var paths      = require('*/cartridge/scripts/migration/core/migrationPaths');
var impexGen   = require('*/cartridge/scripts/migration/orders/generators/impexGenerator');

var MODULE_KEY              = 'order';
var PAGE_LIMIT              = connector.DEFAULT_LIMIT;
var MAX_SINGLE_FILE_ORDERS  = 50000;

/**
 * @param {Object} options
 * @returns {Object}
 */
function buildFetchOptions(options) {
    var years    = parseInt(String(options.years || 1), 10);
    var maxCount = options.maxCount ? parseInt(String(options.maxCount), 10) : null;
    return {
        years:        years,
        maxCount:     maxCount,
        orderState:   options.orderState || '',
        paymentState: options.paymentState || '',
        sinceDate:    connector.dateYearsAgo(years)
    };
}

/**
 * Stream CTP orders into one IMPEX XML file without holding all orders or XML in memory.
 * @param {Object} options
 * @returns {Object}
 */
function runSingleFile(options) {
    var fetchOpts = buildFetchOptions(options);
    var token     = connector.authenticate(options.creds);
    var impexPath = paths.getRelativePath(MODULE_KEY);
    var runDate   = fileResolver.getRunDate(MODULE_KEY, 0);
    var fileName  = fileResolver.resolveXmlFileName(MODULE_KEY, 0, 1, 'local');
    var dir       = impexGen.ensureDir(impexPath);
    var outFile   = new File(dir, fileName);
    var writer    = null;

    var ordersProcessed = 0;
    var ordersValidated = 0;
    var ordersFailed    = 0;
    var errors          = [];
    var offset          = 0;
    var ctpTotal        = null;
    var exportTotal     = null;
    var maxCount        = fetchOpts.maxCount;

    try {
        writer = new FileWriter(outFile, 'UTF-8');
        writer.write(xmlGen.buildHeader());

        do {
            var page    = connector.fetchOrdersPage(token, {
                sinceDate:    fetchOpts.sinceDate,
                orderState:   fetchOpts.orderState,
                paymentState: fetchOpts.paymentState,
                offset:       offset,
                limit:        PAGE_LIMIT
            });
            var results = page.results || [];

            if (ctpTotal === null) {
                ctpTotal    = page.total || 0;
                exportTotal = ctpTotal;
                if (maxCount && maxCount > 0 && maxCount < exportTotal) {
                    exportTotal = maxCount;
                }
                if (exportTotal > MAX_SINGLE_FILE_ORDERS) {
                    writer.close();
                    return {
                        ok:    false,
                        error: 'Too many orders (' + exportTotal + ') for a single XML file. '
                            + 'Maximum is ' + MAX_SINGLE_FILE_ORDERS + '.'
                    };
                }
            }

            var i;
            for (i = 0; i < results.length; i++) {
                if (maxCount && ordersProcessed >= maxCount) {
                    break;
                }

                ordersProcessed++;
                try {
                    var canonical = mapper.mapOrder(results[i]);
                    var vResult   = validator.validateOrder(canonical);
                    if (!vResult.valid) {
                        ordersFailed++;
                        if (errors.length < 5) {
                            errors.push((canonical.orderNumber || '?') + ': ' + vResult.errors.join('; '));
                        }
                        continue;
                    }

                    var inner = xmlGen.generateOrderInnerXml(canonical);
                    xmlGen.assertValidOrderDocument(inner);
                    writer.write(inner);
                    writer.write('\n');
                    ordersValidated++;
                } catch (e) {
                    ordersFailed++;
                    if (errors.length < 5) {
                        errors.push('order: ' + (e.message || String(e)));
                    }
                }
            }

            offset += results.length;
            if (maxCount && ordersProcessed >= maxCount) {
                break;
            }
        } while (offset < ctpTotal && results.length > 0);

        writer.write(xmlGen.buildFooter());
        writer.close();
        writer = null;

        return {
            ok:                true,
            singleFile:        true,
            done:              true,
            total:             exportTotal || ordersProcessed,
            nextOffset:        ordersProcessed,
            ordersProcessed:   ordersProcessed,
            ordersValidated:   ordersValidated,
            ordersFailed:      ordersFailed,
            built:             ordersValidated,
            failed:            ordersFailed,
            errors:            errors,
            xmlFilesGenerated: ordersValidated > 0 ? 1 : 0,
            fileName:          fileName,
            runId:             runDate,
            runDate:           runDate,
            impexPath:         impexPath
        };
    } catch (e) {
        if (writer) {
            try { writer.close(); } catch (ce) { /* ignore */ }
        }
        return { ok: false, error: e.message || String(e) };
    }
}

/**
 * @param {number} offset
 * @param {Object} options
 * @param {boolean} [singleFile]
 * @returns {Object}
 */
function runBatch(offset, options, singleFile) {
    var useSingleFile = singleFile !== false;

    if (useSingleFile) {
        if (offset > 0) {
            return {
                ok:                true,
                singleFile:        true,
                done:              true,
                total:             offset,
                nextOffset:        offset,
                ordersProcessed:   0,
                ordersValidated:   0,
                ordersFailed:      0,
                built:             0,
                failed:            0,
                errors:            [],
                xmlFilesGenerated: 0,
                impexPath:         paths.getRelativePath(MODULE_KEY)
            };
        }
        return runSingleFile(options);
    }

    return runSingleFile(options);
}

module.exports = {
    PAGE_LIMIT:             PAGE_LIMIT,
    MAX_SINGLE_FILE_ORDERS: MAX_SINGLE_FILE_ORDERS,
    runBatch:               runBatch
};
