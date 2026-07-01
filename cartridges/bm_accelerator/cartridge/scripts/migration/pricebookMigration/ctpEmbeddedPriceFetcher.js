'use strict';

var productFetcher = require('*/cartridge/scripts/migration/productMigration/ctpProductFetcher');
var standalone     = require('*/cartridge/scripts/migration/pricebookMigration/ctpPricebookFetcher');
var extractor      = require('*/cartridge/scripts/migration/pricebookMigration/embeddedPriceExtractor');

var DISC_PAGE = 500;
var SESS = {
    agg:      'pbDisc_emb_agg',
    ch:       'pbDisc_emb_ch',
    channels: 'pbDisc_emb_channels',
    offset:   'pbDisc_emb_offset',
    total:    'pbDisc_emb_total'
};

function exportKeySafe(key) {
    return String(key || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function readSessionMap(key) {
    try {
        return JSON.parse(String(session.custom[key] || '{}'));
    } catch (e) {
        return {};
    }
}

function writeSessionMap(key, obj) {
    session.custom[key] = JSON.stringify(obj || {});
}

function channelsByIdFromList(channels) {
    var map = {};
    var i;
    for (i = 0; i < channels.length; i++) {
        map[channels[i].id] = channels[i];
    }
    return map;
}

function buildTargetsFromMaps(aggByCurrency, byCurChannel, channelsById) {
    var targets    = [];
    var currencies = Object.keys(aggByCurrency).sort();
    var ci;

    for (ci = 0; ci < currencies.length; ci++) {
        var currency = currencies[ci];
        targets.push({
            exportKey:  'emb_agg_' + exportKeySafe(currency),
            label:      currency + ' — All channels',
            subLabel:   'Embedded variant prices aggregated per SKU across channels',
            currency:   currency,
            channelId:  'all',
            channelKey: '',
            aggregate:  true,
            priceCount: aggByCurrency[currency],
            source:     'embedded'
        });
    }

    var mapKeys = Object.keys(byCurChannel).sort();
    var ki;
    for (ki = 0; ki < mapKeys.length; ki++) {
        var parts  = mapKeys[ki].split('::');
        var cur2   = parts[0];
        var chId2  = parts[1];
        var chInfo = channelsById[chId2] || { id: chId2, key: chId2, name: chId2 };
        var chKey  = exportKeySafe(chInfo.key || chId2);
        targets.push({
            exportKey:  'emb_' + exportKeySafe(cur2) + '_ch_' + chKey,
            label:      cur2 + ' — ' + (chInfo.name || chInfo.key),
            subLabel:   'Embedded prices — channel: ' + (chInfo.key || chId2),
            currency:   cur2,
            channelId:  chId2,
            channelKey: chInfo.key || '',
            aggregate:  false,
            priceCount: byCurChannel[mapKeys[ki]],
            source:     'embedded'
        });
    }

    return targets;
}

function clearEmbeddedDiscovery() {
    session.custom[SESS.offset] = '0';
    session.custom[SESS.total]  = '';
    writeSessionMap(SESS.agg, {});
    writeSessionMap(SESS.ch, {});
    session.custom[SESS.channels] = '';
}

/**
 * Process one page of products for embedded-price discovery.
 * @param {number} offset
 * @param {boolean} reset
 * @returns {Object}
 */
function discoverEmbeddedStep(offset, reset) {
    if (reset || offset === 0) {
        clearEmbeddedDiscovery();
        var channels = standalone.fetchDistributionChannels();
        session.custom[SESS.channels] = JSON.stringify(channels);
    }

    var agg       = readSessionMap(SESS.agg);
    var byChannel = readSessionMap(SESS.ch);
    var curOffset = parseInt(session.custom[SESS.offset] || '0', 10);
    if (offset > 0) {
        curOffset = offset;
    }

    var batch = productFetcher.fetchBatch(curOffset, DISC_PAGE);
    if (!session.custom[SESS.total]) {
        session.custom[SESS.total] = String(batch.total || 0);
    }

    var i;
    for (i = 0; i < batch.results.length; i++) {
        extractor.scanProductForDiscovery(batch.results[i], agg, byChannel);
    }
    writeSessionMap(SESS.agg, agg);
    writeSessionMap(SESS.ch, byChannel);

    var total      = parseInt(session.custom[SESS.total], 10) || 0;
    var nextOffset = curOffset + batch.results.length;
    session.custom[SESS.offset] = String(nextOffset);

    var done = batch.results.length === 0 || nextOffset >= total;
    if (!done) {
        return {
            done:         false,
            nextOffset:   nextOffset,
            scanned:      nextOffset,
            total:        total,
            productTotal: total,
            embedded:     []
        };
    }

    var channelList = [];
    try {
        channelList = JSON.parse(session.custom[SESS.channels] || '[]');
    } catch (e2) {
        channelList = [];
    }

    clearEmbeddedDiscovery();
    return {
        done:         true,
        nextOffset:   nextOffset,
        scanned:      total,
        total:        total,
        productTotal: total,
        embedded:     buildTargetsFromMaps(agg, byChannel, channelsByIdFromList(channelList))
    };
}

/**
 * Scan all products and discover embedded pricebook targets by currency/channel.
 * @returns {Array}
 */
function discoverEmbeddedPricebookTargets() {
    var result = discoverEmbeddedStep(0, true);
    while (!result.done) {
        result = discoverEmbeddedStep(result.nextOffset, false);
    }
    return result.embedded || [];
}

/**
 * Count embedded prices matching a target by scanning all products.
 * @param {string} currency
 * @param {string} [channelId]
 * @param {boolean} [aggregate]
 * @returns {number}
 */
function getPriceCount(currency, channelId, aggregate) {
    var total  = 0;
    var offset = 0;
    var limit  = 500;
    var batch;
    var chId   = (channelId && channelId !== 'all') ? channelId : 'all';

    do {
        batch = productFetcher.fetchBatch(offset, limit);
        var i;
        for (i = 0; i < batch.results.length; i++) {
            var records = extractor.extractRecordsFromProduct(
                batch.results[i], currency, chId, aggregate
            );
            total += records.length;
        }
        offset += batch.results.length;
    } while (batch.results.length === limit && offset < batch.total);

    return total;
}

/**
 * Fetch one batch of products and extract price records for a target.
 * @param {number} offset - product offset
 * @param {number} limit
 * @param {string} currency
 * @param {string} [channelId]
 * @param {boolean} [aggregate]
 * @returns {{ records: Array, total: number, nextOffset: number, done: boolean }}
 */
function fetchPriceRecordsBatch(offset, limit, currency, channelId, aggregate) {
    var batch = productFetcher.fetchBatch(offset, limit || 500);
    var total = batch.total;
    var records = [];
    var i;
    var chId = (channelId && channelId !== 'all') ? channelId : 'all';

    for (i = 0; i < batch.results.length; i++) {
        var productRecords = extractor.extractRecordsFromProduct(
            batch.results[i], currency, chId, aggregate
        );
        if (productRecords.length) {
            records = records.concat(productRecords);
        }
    }

    var nextOffset = offset + batch.results.length;
    return {
        records:    records,
        total:      total,
        nextOffset: nextOffset,
        done:       nextOffset >= total || batch.results.length === 0
    };
}

module.exports = {
    discoverEmbeddedPricebookTargets: discoverEmbeddedPricebookTargets,
    discoverEmbeddedStep:           discoverEmbeddedStep,
    getPriceCount:                  getPriceCount,
    getProductCount:                productFetcher.getCount,
    fetchPriceRecordsBatch:         fetchPriceRecordsBatch
};
