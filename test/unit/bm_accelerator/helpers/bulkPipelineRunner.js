'use strict';

var fixtures = require('../fixtures/ctpBulkFixtures');
var cartridgeLoader = require('./cartridgeLoader');

cartridgeLoader.installCartridgeResolver();

var shippingXmlBuilder   = cartridgeLoader.requireCartridge('shippingMethodMigration/shippingMethodXmlBuilder');
var shippingTransformer  = cartridgeLoader.requireCartridge('shippingMethodMigration/shippingMethodTransformer');
var inventoryTransformer = cartridgeLoader.requireCartridge('inventoryMigration/inventoryTransformer');
var inventoryXmlBuilder  = cartridgeLoader.requireCartridge('inventoryMigration/inventoryXmlBuilder');
var pricebookTransformer = cartridgeLoader.requireCartridge('pricebookMigration/pricebookTransformer');
var pricebookXmlBuilder  = cartridgeLoader.requireCartridge('pricebookMigration/pricebookXmlBuilder');
var embeddedExtractor    = cartridgeLoader.requireCartridge('pricebookMigration/embeddedPriceExtractor');
var taxTransformer       = cartridgeLoader.requireCartridge('taxMigration/taxTransformer');
var taxXmlBuilder        = cartridgeLoader.requireCartridge('taxMigration/taxXmlBuilder');
var storeTransformer     = cartridgeLoader.requireCartridge('storeMigration/storeTransformer');
var storeXmlBuilder      = cartridgeLoader.requireCartridge('storeMigration/storeXmlBuilder');

var BATCH_SIZES = {
    shippingMethod: 50,
    inventory:      500,
    pricebook:      500,
    tax:            500,
    store:          500
};

var GEN_BATCH = 2000;

function runPagedBatches(items, batchSize, fn) {
    var offset      = 0;
    var totalBuilt  = 0;
    var totalFailed = 0;
    var batches     = 0;
    var errors      = [];

    while (offset < items.length) {
        var batch  = items.slice(offset, offset + batchSize);
        var result = fn(batch, offset) || {};
        totalBuilt  += result.built || 0;
        totalFailed += result.failed || 0;
        batches++;
        if (result.errors && result.errors.length) {
            errors = errors.concat(result.errors);
        }
        offset += batch.length;
    }

    return {
        inputCount: items.length,
        batchSize:  batchSize,
        batches:    batches,
        built:      totalBuilt,
        failed:     totalFailed,
        errors:     errors.slice(0, 10)
    };
}

/**
 * Stream through totalCount records without holding all CTP objects in memory.
 * @param {number} totalCount
 * @param {number} processBatchSize - runner batch size (matches production)
 * @param {number} generateBatchSize - fixture generation chunk
 * @param {Function} generateBatch - (offset, count) => Array
 * @param {Function} processBatch - (batch, offset) => { built, failed, errors }
 */
function runCountedBatches(totalCount, processBatchSize, generateBatchSize, generateBatch, processBatch) {
    var offset      = 0;
    var totalBuilt  = 0;
    var totalFailed = 0;
    var batches     = 0;
    var errors      = [];
    var genSize     = generateBatchSize || GEN_BATCH;
    var buffer      = [];
    var bufferOffset = 0;

    function flushBuffer() {
        while (buffer.length >= processBatchSize) {
            var batch  = buffer.splice(0, processBatchSize);
            var result = processBatch(batch, bufferOffset) || {};
            totalBuilt  += result.built || 0;
            totalFailed += result.failed || 0;
            batches++;
            if (result.errors && result.errors.length) {
                errors = errors.concat(result.errors);
            }
            bufferOffset += batch.length;
        }
    }

    while (offset < totalCount) {
        var chunk = Math.min(genSize, totalCount - offset);
        buffer    = buffer.concat(generateBatch(offset, chunk));
        offset   += chunk;
        flushBuffer();
    }

    while (buffer.length > 0) {
        var tail   = buffer.splice(0, Math.min(processBatchSize, buffer.length));
        var tailResult = processBatch(tail, bufferOffset) || {};
        totalBuilt  += tailResult.built || 0;
        totalFailed += tailResult.failed || 0;
        batches++;
        if (tailResult.errors && tailResult.errors.length) {
            errors = errors.concat(tailResult.errors);
        }
        bufferOffset += tail.length;
    }

    return {
        inputCount: totalCount,
        batchSize:  processBatchSize,
        batches:    batches,
        built:      totalBuilt,
        failed:     totalFailed,
        errors:     errors.slice(0, 10)
    };
}

function runShippingPipeline(ctpMethods) {
    if (typeof ctpMethods === 'number') {
        return runShippingPipelineCount(ctpMethods);
    }
    return runPagedBatches(ctpMethods, BATCH_SIZES.shippingMethod, function (batch) {
        return shippingXmlBuilder.buildXml(batch);
    });
}

function runShippingPipelineCount(totalCount) {
    return runCountedBatches(
        totalCount,
        BATCH_SIZES.shippingMethod,
        GEN_BATCH,
        fixtures.shippingMethodsBatch,
        function (batch) {
            return shippingXmlBuilder.buildXml(batch);
        }
    );
}

function runInventoryPipeline(ctpEntries, opts) {
    if (typeof ctpEntries === 'number') {
        return runInventoryPipelineCount(ctpEntries, opts);
    }
    var options   = opts || {};
    var listId    = options.listId || 'bulk-inventory-list';
    var aggregate = options.aggregate !== false;

    return runPagedBatches(ctpEntries, BATCH_SIZES.inventory, function (batch) {
        var records = aggregate
            ? inventoryTransformer.aggregateBySku(batch)
            : batch.map(inventoryTransformer.transformEntry).filter(Boolean);
        return inventoryXmlBuilder.buildXml(records, listId, 'Bulk inventory test');
    });
}

function runInventoryPipelineCount(totalCount, opts) {
    var options   = opts || {};
    var listId    = options.listId || 'bulk-inventory-list';
    var aggregate = options.aggregate !== false;
    var channels  = fixtures.buildInventoryChannels(options.channelCount || fixtures.targetCount('inventoryChannels'));

    return runCountedBatches(
        totalCount,
        BATCH_SIZES.inventory,
        GEN_BATCH,
        function (offset, count) {
            return fixtures.inventoryEntriesBatch(offset, count, channels);
        },
        function (batch) {
            var records = aggregate
                ? inventoryTransformer.aggregateBySku(batch)
                : batch.map(inventoryTransformer.transformEntry).filter(Boolean);
            return inventoryXmlBuilder.buildXml(records, listId, 'Bulk inventory test');
        }
    );
}

function runStandalonePricebookPipeline(ctpPrices, opts) {
    if (typeof ctpPrices === 'number') {
        return runStandalonePricebookPipelineCount(ctpPrices, opts);
    }
    var options     = opts || {};
    var pricebookId = options.pricebookId || 'bulk-list-prices';
    var currency    = options.currency || 'USD';
    var aggregate   = options.aggregate !== false;

    return runPagedBatches(ctpPrices, BATCH_SIZES.pricebook, function (batch) {
        var records = aggregate
            ? pricebookTransformer.aggregateBySku(batch)
            : batch.map(pricebookTransformer.transformEntry).filter(Boolean);
        return pricebookXmlBuilder.buildXml(records, pricebookId, currency, 'Bulk pricebook test');
    });
}

function runStandalonePricebookPipelineCount(totalCount, opts) {
    var options     = opts || {};
    var pricebookId = options.pricebookId || 'bulk-list-prices';
    var currency    = options.currency || 'USD';
    var aggregate   = options.aggregate !== false;
    var channels    = fixtures.buildPricebookChannels(options.channelCount || fixtures.targetCount('pricebookChannels'));

    return runCountedBatches(
        totalCount,
        BATCH_SIZES.pricebook,
        GEN_BATCH,
        function (offset, count) {
            return fixtures.standalonePricesBatch(offset, count, channels);
        },
        function (batch) {
            var records = aggregate
                ? pricebookTransformer.aggregateBySku(batch)
                : batch.map(pricebookTransformer.transformEntry).filter(Boolean);
            return pricebookXmlBuilder.buildXml(records, pricebookId, currency, 'Bulk pricebook test');
        }
    );
}

function runEmbeddedPricebookPipeline(ctpProducts, opts) {
    if (typeof ctpProducts === 'number') {
        return runEmbeddedPricebookPipelineCount(ctpProducts, opts);
    }
    var options     = opts || {};
    var currency    = options.currency || 'USD';
    var channelId   = options.channelId || 'all';
    var aggregate   = options.aggregate !== false;
    var pricebookId = options.pricebookId || 'bulk-embedded-prices';

    return runPagedBatches(ctpProducts, BATCH_SIZES.pricebook, function (batch) {
        var records = [];
        var pi;
        for (pi = 0; pi < batch.length; pi++) {
            records = records.concat(embeddedExtractor.extractRecordsFromProduct(
                batch[pi], currency, channelId, aggregate
            ));
        }
        if (aggregate) {
            records = dedupePriceRecords(records);
        }
        return pricebookXmlBuilder.buildXml(records, pricebookId, currency, 'Bulk embedded pricebook test');
    });
}

function runEmbeddedPricebookPipelineCount(totalCount, opts) {
    var options     = opts || {};
    var currency    = options.currency || 'USD';
    var channelId   = options.channelId || 'all';
    var aggregate   = options.aggregate !== false;
    var pricebookId = options.pricebookId || 'bulk-embedded-prices';
    var variants    = options.variantsPerProduct || 2;

    return runCountedBatches(
        totalCount,
        BATCH_SIZES.pricebook,
        Math.min(500, GEN_BATCH),
        function (offset, count) {
            return fixtures.productsWithEmbeddedPricesBatch(offset, count, variants);
        },
        function (batch) {
            var records = [];
            var pi;
            for (pi = 0; pi < batch.length; pi++) {
                records = records.concat(embeddedExtractor.extractRecordsFromProduct(
                    batch[pi], currency, channelId, aggregate
                ));
            }
            if (aggregate) {
                records = dedupePriceRecords(records);
            }
            return pricebookXmlBuilder.buildXml(records, pricebookId, currency, 'Bulk embedded pricebook test');
        }
    );
}

function dedupePriceRecords(records) {
    var map = {};
    var out = [];
    var i;
    for (i = 0; i < records.length; i++) {
        var r = records[i];
        if (!map[r.sku]) {
            map[r.sku] = r;
            out.push(r);
        } else if (!r.hasChannel && map[r.sku].hasChannel) {
            var idx = out.indexOf(map[r.sku]);
            map[r.sku] = r;
            if (idx >= 0) out[idx] = r;
        }
    }
    return out;
}

function runTaxPipeline(ctpCategories, filter) {
    if (typeof ctpCategories === 'number') {
        return runTaxPipelineCount(ctpCategories, filter);
    }
    var model  = taxTransformer.buildTaxModel(ctpCategories, filter || { type: 'full', id: '' });
    var result = taxXmlBuilder.buildXml(model);
    return {
        inputCount:    ctpCategories.length,
        batchSize:     ctpCategories.length,
        batches:       1,
        built:         result.built,
        failed:        result.failed,
        errors:        result.errors || [],
        taxClasses:    model.taxClasses.length,
        taxRates:      model.taxRates.length,
        jurisdictions: model.jurisdictions.length
    };
}

function runTaxPipelineCount(categoryCount, filter) {
    var rates = fixtures.targetCount('taxRatesPerCategory');
    var cats  = fixtures.taxCategoriesBatch(0, categoryCount, rates);
    return runTaxPipeline(cats, filter);
}

function runStorePipeline(ctpStores, channelById) {
    if (typeof ctpStores === 'number') {
        return runStorePipelineCount(ctpStores);
    }
    var records = storeTransformer.buildStoreRecords(ctpStores, channelById);
    var result  = storeXmlBuilder.buildXml(records);
    return {
        inputCount:  ctpStores.length,
        batchSize:   ctpStores.length,
        batches:     1,
        built:       result.built,
        failed:      result.failed,
        errors:      result.errors || [],
        recordCount: records.length
    };
}

function runStorePipelineCount(totalCount) {
    var channels    = fixtures.buildStoreChannels(fixtures.targetCount('storeChannels'));
    var channelById = fixtures.channelMapFromList(channels);

    return runCountedBatches(
        totalCount,
        BATCH_SIZES.store,
        GEN_BATCH,
        function (offset, count) {
            return fixtures.storesBatch(offset, count, channels);
        },
        function (batch) {
            var records = storeTransformer.buildStoreRecords(batch, channelById);
            return storeXmlBuilder.buildXml(records);
        }
    );
}

function summarizeShippingMethods(ctpMethods) {
    var out = [];
    var i;
    for (i = 0; i < ctpMethods.length; i++) {
        out.push(shippingTransformer.toSummary(ctpMethods[i]));
    }
    return out;
}

module.exports = {
    BATCH_SIZES:                    BATCH_SIZES,
    GEN_BATCH:                      GEN_BATCH,
    runPagedBatches:                runPagedBatches,
    runCountedBatches:              runCountedBatches,
    runShippingPipeline:            runShippingPipeline,
    runShippingPipelineCount:       runShippingPipelineCount,
    runInventoryPipeline:           runInventoryPipeline,
    runInventoryPipelineCount:      runInventoryPipelineCount,
    runStandalonePricebookPipeline:   runStandalonePricebookPipeline,
    runStandalonePricebookPipelineCount: runStandalonePricebookPipelineCount,
    runEmbeddedPricebookPipeline:   runEmbeddedPricebookPipeline,
    runEmbeddedPricebookPipelineCount: runEmbeddedPricebookPipelineCount,
    runTaxPipeline:                 runTaxPipeline,
    runTaxPipelineCount:            runTaxPipelineCount,
    runStorePipeline:               runStorePipeline,
    runStorePipelineCount:          runStorePipelineCount,
    summarizeShippingMethods:     summarizeShippingMethods
};
