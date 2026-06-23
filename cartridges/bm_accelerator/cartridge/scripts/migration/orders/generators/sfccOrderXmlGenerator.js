'use strict';

var localizedString = require('*/cartridge/scripts/migration/orders/localizedString').localizedString;

var XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';
var NS_ORDER   = 'http://www.demandware.com/xml/impex/order/2007-03-31';

/**
 * Escape XML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Format a number to two decimal places for XML.
 * @param {number} n
 * @returns {string}
 */
function fmtMoney(n) {
    var val = parseFloat(n) || 0;
    return val.toFixed(2);
}

/**
 * Build XML for a canonical address.
 * @param {string} tagName - e.g. billing-address
 * @param {Object} addr
 * @returns {string}
 */
function addressXml(tagName, addr) {
    if (!addr) return '';
    var lines = [
        '        <' + tagName + '>',
        '            <first-name>' + escapeXml(addr.firstName) + '</first-name>',
        '            <last-name>' + escapeXml(addr.lastName) + '</last-name>',
        '            <address1>' + escapeXml(addr.address1) + '</address1>',
        '            <city>' + escapeXml(addr.city) + '</city>',
        '            <postal-code>' + escapeXml(addr.postalCode) + '</postal-code>',
        '            <state-code>' + escapeXml(addr.stateCode) + '</state-code>',
        '            <country-code>' + escapeXml(addr.countryCode) + '</country-code>',
        '            <phone>' + escapeXml(addr.phone) + '</phone>'
    ];
    if (addr.company) {
        lines.splice(4, 0, '            <company-name>' + escapeXml(addr.company) + '</company-name>');
    }
    if (addr.address2) {
        lines.splice(5, 0, '            <address2>' + escapeXml(addr.address2) + '</address2>');
    }
    lines.push('        </' + tagName + '>');
    return lines.join('\n');
}

function lineItemDisplayName(li) {
    return localizedString(li.name, li.sku || '');
}

/**
 * Build product line items XML.
 * @param {Object[]} lineItems
 * @returns {string}
 */
function lineItemsXml(lineItems) {
    var parts = ['        <product-lineitems>'];
    for (var i = 0; i < lineItems.length; i++) {
        var li = lineItems[i];
        var displayName = lineItemDisplayName(li);
        parts.push('            <product-lineitem>');
        parts.push('                <net-price>' + fmtMoney(li.netPrice) + '</net-price>');
        parts.push('                <tax>' + fmtMoney(li.taxAmount) + '</tax>');
        parts.push('                <gross-price>' + fmtMoney(li.grossPrice) + '</gross-price>');
        parts.push('                <base-price>' + fmtMoney(li.unitPrice) + '</base-price>');
        parts.push('                <lineitem-text>' + escapeXml(displayName) + '</lineitem-text>');
        parts.push('                <position>' + (i + 1) + '</position>');
        parts.push('                <product-id>' + escapeXml(li.sku) + '</product-id>');
        parts.push('                <product-name>' + escapeXml(displayName) + '</product-name>');
        parts.push('                <quantity>');
        parts.push('                    <unit></unit>');
        parts.push('                    <value>' + (li.quantity || 1) + '.0</value>');
        parts.push('                </quantity>');
        parts.push('            </product-lineitem>');
    }
    parts.push('        </product-lineitems>');
    return parts.join('\n');
}

/**
 * Build totals XML block.
 * @param {Object} order
 * @returns {string}
 */
function totalsXml(order) {
    var merch = fmtMoney(order.merchandiseTotal);
    var ship  = fmtMoney(order.shippingTotal);
    var tax   = fmtMoney(order.taxTotal);
    var total = fmtMoney(order.orderTotal);
    return [
        '        <totals>',
        '            <merchandize-total>',
        '                <net-price>' + merch + '</net-price>',
        '                <tax>' + tax + '</tax>',
        '                <gross-price>' + total + '</gross-price>',
        '            </merchandize-total>',
        '            <adjusted-merchandize-total>',
        '                <net-price>' + merch + '</net-price>',
        '                <tax>' + tax + '</tax>',
        '                <gross-price>' + total + '</gross-price>',
        '            </adjusted-merchandize-total>',
        '            <shipping-total>',
        '                <net-price>' + ship + '</net-price>',
        '                <tax>0.00</tax>',
        '                <gross-price>' + ship + '</gross-price>',
        '            </shipping-total>',
        '            <order-total>',
        '                <net-price>' + merch + '</net-price>',
        '                <tax>' + tax + '</tax>',
        '                <gross-price>' + total + '</gross-price>',
        '            </order-total>',
        '        </totals>'
    ].join('\n');
}

/**
 * Build shipments XML block.
 * @param {Object[]} shipments
 * @param {string} orderNumber
 * @returns {string}
 */
function shipmentsXml(shipments, orderNumber) {
    if (!shipments || !shipments.length) return '';
    var parts = ['        <shipments>'];
    for (var i = 0; i < shipments.length; i++) {
        var s = shipments[i];
        parts.push('            <shipment shipment-id="' + escapeXml(s.id || orderNumber) + '">');
        parts.push('                <status>');
        parts.push('                    <shipping-status>' + escapeXml(s.status || 'NOT_SHIPPED') + '</shipping-status>');
        parts.push('                </status>');
        if (s.shippingMethod) {
            parts.push('                <shipping-method>' + escapeXml(s.shippingMethod) + '</shipping-method>');
        }
        parts.push('            </shipment>');
    }
    parts.push('        </shipments>');
    return parts.join('\n');
}

/**
 * Generate inner <order> XML block (no wrapper).
 * @param {Object} order - CanonicalOrder
 * @returns {string}
 */
function generateOrderInnerXml(order) {
    var orderNo = escapeXml(order.orderNumber);
    var parts   = [
        '    <order order-no="' + orderNo + '">',
        '        <order-date>' + escapeXml(order.createdAt) + '</order-date>',
        '        <created-by>migration</created-by>',
        '        <original-order-no>' + orderNo + '</original-order-no>',
        '        <currency>' + escapeXml(order.currency) + '</currency>',
        '        <customer>',
        '            <customer-no>' + escapeXml(order.customer.id || order.customer.email) + '</customer-no>',
        '            <customer-name>' + escapeXml((order.customer.firstName + ' ' + order.customer.lastName).trim()) + '</customer-name>',
        '            <customer-email>' + escapeXml(order.customer.email) + '</customer-email>',
        '        </customer>',
        '        <status>',
        '            <order-status>' + escapeXml(order.status || 'NEW') + '</order-status>',
        '            <shipping-status>NOT_SHIPPED</shipping-status>',
        '            <confirmation-status>CONFIRMED</confirmation-status>',
        '            <payment-status>' + escapeXml(order.paymentStatus || 'NOT_PAID') + '</payment-status>',
        '        </status>',
        '        <current-order-no>' + orderNo + '</current-order-no>',
        lineItemsXml(order.lineItems),
        totalsXml(order),
        shipmentsXml(order.shipments, order.orderNumber),
        addressXml('billing-address', order.billingAddress),
        addressXml('shipping-address', order.shippingAddress || order.billingAddress),
        '    </order>'
    ];
    return parts.join('\n');
}

/**
 * Generate SFCC order XML for a single canonical order.
 * @param {Object} order - CanonicalOrder
 * @returns {string}
 */
function generateOrderXml(order) {
    return [
        XML_HEADER,
        '<orders xmlns="' + NS_ORDER + '">',
        generateOrderInnerXml(order),
        '</orders>'
    ].join('\n');
}

/**
 * Generate chunked XML files from an array of canonical orders.
 * @param {Object[]} orders
 * @param {number} [chunkSize=5000]
 * @returns {Object[]} { fileName, content }[]
 */
function generateChunkedXml(orders, chunkSize) {
    var size   = chunkSize || 5000;
    var chunks = [];
    var total  = orders.length;
    var fileIndex = 1;

    for (var offset = 0; offset < total; offset += size) {
        var slice  = [];
        var end    = Math.min(offset + size, total);
        for (var i = offset; i < end; i++) {
            slice.push(orders[i]);
        }

        var parts = [XML_HEADER, '<orders xmlns="' + NS_ORDER + '">'];
        for (var j = 0; j < slice.length; j++) {
            parts.push(generateOrderInnerXml(slice[j]));
        }
        parts.push('</orders>');

        var padded = String(fileIndex);
        while (padded.length < 3) padded = '0' + padded;

        chunks.push({
            fileName: 'orders_' + padded + '.xml',
            content:  parts.join('\n')
        });
        fileIndex++;
    }

    return chunks;
}

module.exports = {
    escapeXml:            escapeXml,
    fmtMoney:             fmtMoney,
    generateOrderInnerXml: generateOrderInnerXml,
    generateOrderXml:     generateOrderXml,
    generateChunkedXml:   generateChunkedXml,
    DEFAULT_CHUNK_SIZE:   5000
};
