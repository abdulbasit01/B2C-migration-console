'use strict';

function xmlEsc(val) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&apos;');
}

function toDecimal(value) {
    if (!value || typeof value.centAmount !== 'number') return '';
    var digits  = typeof value.fractionDigits === 'number' ? value.fractionDigits : 2;
    var divisor = Math.pow(10, digits);
    return (value.centAmount / divisor).toFixed(digits);
}

/**
 * Pick the best price for a given currency from a CT prices array.
 * Prefers base (no channel, no country) prices; falls back to first price.
 * @param {Array}  prices
 * @param {string} currency e.g. "USD"
 * @returns {Object|null} CT price value object
 */
function findPrice(prices, currency) {
    if (!prices || !prices.length) return null;
    for (var i = 0; i < prices.length; i++) {
        var p = prices[i];
        if (p.value && p.value.currencyCode === currency && !p.channel && !p.country) return p.value;
    }
    for (var j = 0; j < prices.length; j++) {
        var q = prices[j];
        if (q.value && q.value.currencyCode === currency) return q.value;
    }
    return prices[0] && prices[0].value ? prices[0].value : null;
}

/**
 * Build SFCC pricebook XML for one batch of transformed products.
 * Prices are extracted from each variant's embedded prices[] array.
 *
 * @param {Array}  transformedProducts - output of productTransformer (variants must include prices[])
 * @param {string} pricebookId         - target SFCC pricebook ID  (e.g. "list-prices")
 * @param {string} currency            - ISO currency code         (e.g. "USD")
 * @returns {{ xml: string, built: number }}
 */
function buildXml(transformedProducts, pricebookId, currency) {
    var pbId  = pricebookId || 'list-prices';
    var cur   = currency    || 'USD';
    var built = 0;
    var rows  = '';

    for (var pi = 0; pi < transformedProducts.length; pi++) {
        var variants = transformedProducts[pi].variants || [];
        for (var vi = 0; vi < variants.length; vi++) {
            var variant  = variants[vi];
            var priceVal = findPrice(variant.prices, cur);
            if (!priceVal) continue;
            var amount = toDecimal(priceVal);
            if (!amount) continue;
            rows += '            <price-table product-id="' + xmlEsc(variant.productId) + '">\n';
            rows += '                <amount quantity="1">' + amount + '</amount>\n';
            rows += '            </price-table>\n';
            built++;
        }
    }

    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<pricebooks xmlns="http://www.demandware.com/xml/impex/pricebook/2006-10-31">\n'
        + '    <pricebook>\n'
        + '        <header pricebook-id="' + xmlEsc(pbId) + '">\n'
        + '            <currency>' + xmlEsc(cur) + '</currency>\n'
        + '            <display-name xml:lang="x-default">CT Migrated Prices</display-name>\n'
        + '            <online-flag>true</online-flag>\n'
        + '        </header>\n'
        + '        <price-tables>\n'
        + rows
        + '        </price-tables>\n'
        + '    </pricebook>\n'
        + '</pricebooks>\n';

    return { xml: xml, built: built };
}

module.exports = { buildXml: buildXml };
