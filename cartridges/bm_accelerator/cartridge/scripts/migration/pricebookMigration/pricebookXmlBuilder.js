'use strict';

var NS_PRICEBOOK = 'http://www.demandware.com/xml/impex/pricebook/2006-10-31';

function xmlEsc(val) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&apos;');
}

/**
 * @param {Object} record
 * @returns {string}
 */
function buildPriceTableXml(record) {
    return '            <price-table product-id="' + xmlEsc(record.sku) + '">\n'
        + '                <amount quantity="1">' + record.amount + '</amount>\n'
        + '            </price-table>\n';
}

/**
 * Build SFCC pricebook IMPEX XML.
 * @param {Array} records
 * @param {string} pricebookId
 * @param {string} currency
 * @param {string} [description]
 * @returns {{ xml: string, built: number, failed: number, errors: Array }}
 */
function buildXml(records, pricebookId, currency, description) {
    var pbId   = pricebookId || 'list-prices';
    var cur    = currency || 'USD';
    var desc   = description || 'Commercetools standalone-price migration';
    var built  = 0;
    var failed = 0;
    var errors = [];
    var rows   = '';
    var i;

    for (i = 0; i < records.length; i++) {
        try {
            if (!records[i] || !records[i].sku || !records[i].amount) {
                failed++;
                continue;
            }
            rows += buildPriceTableXml(records[i]);
            built++;
        } catch (e) {
            failed++;
            if (errors.length < 5) {
                errors.push((records[i].sku || '?') + ': ' + (e.message || String(e)));
            }
        }
    }

    var xml = buildHeader(pbId, cur, desc) + rows + buildFooter();

    return { xml: xml, built: built, failed: failed, errors: errors };
}

function buildHeader(pricebookId, currency, description) {
    var pbId = pricebookId || 'list-prices';
    var cur  = currency || 'USD';
    var desc = description || 'Commercetools standalone-price migration';
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<pricebooks xmlns="' + NS_PRICEBOOK + '">\n'
        + '    <pricebook>\n'
        + '        <header pricebook-id="' + xmlEsc(pbId) + '">\n'
        + '            <currency>' + xmlEsc(cur) + '</currency>\n'
        + '            <display-name xml:lang="x-default">' + xmlEsc(desc) + '</display-name>\n'
        + '            <online-flag>true</online-flag>\n'
        + '        </header>\n'
        + '        <price-tables>\n';
}

function buildFooter() {
    return '        </price-tables>\n'
        + '    </pricebook>\n'
        + '</pricebooks>\n';
}

module.exports = {
    buildXml:            buildXml,
    buildHeader:         buildHeader,
    buildFooter:         buildFooter,
    buildPriceTableXml:  buildPriceTableXml,
    NS_PRICEBOOK:        NS_PRICEBOOK
};
