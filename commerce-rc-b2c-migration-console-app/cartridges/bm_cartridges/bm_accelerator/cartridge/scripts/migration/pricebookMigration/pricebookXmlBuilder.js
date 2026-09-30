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
 * pricebook.xsd types product-id as NonEmptyString.100, whose pattern requires a non-whitespace first and last character:
 * leading/trailing whitespace fails BM validation and aborts the whole import,
 * so IDs are trimmed here as a last line of defence for every source platform.
 * @param {*} value
 * @returns {string} trimmed ID, or '' when nothing usable is left
 */
function normalizeProductId(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

/**
 * @param {Object} record
 * @returns {string}
 * @throws {Error} when the record has no usable product ID after trimming
 */
function buildPriceTableXml(record) {
    var productId = normalizeProductId(record.productId || record.sku);
    if (!productId) {
        throw new Error('Empty product-id after trimming whitespace');
    }
    // SFCC's price-table schema only allows amount/percentage/price-info as children —
    // custom-attributes is not valid here (confirmed by a real BM import validation error),
    // so per-price custom fields cannot be represented in this XML at all. Quantity tiers,
    // however, map directly onto multiple <amount quantity="N"> rows in the same table.
    var xml = '            <price-table product-id="' + xmlEsc(productId) + '">\n'
        + '                <amount quantity="1">' + record.amount + '</amount>\n';

    if (record.tiers && record.tiers.length) {
        for (var i = 0; i < record.tiers.length; i++) {
            xml += '                <amount quantity="' + xmlEsc(record.tiers[i].quantity) + '">'
                + xmlEsc(record.tiers[i].amount) + '</amount>\n';
        }
    }

    xml += '            </price-table>\n';
    return xml;
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
    var desc   = description || 'Source pricebook migration';
    var built  = 0;
    var failed = 0;
    var errors = [];
    var rows   = '';
    var i;

    for (i = 0; i < records.length; i++) {
        try {
            if (!records[i] || !normalizeProductId(records[i].productId || records[i].sku) || !records[i].amount) {
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
    var desc = description || 'Source pricebook migration';
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
    normalizeProductId:  normalizeProductId,
    NS_PRICEBOOK:        NS_PRICEBOOK
};
