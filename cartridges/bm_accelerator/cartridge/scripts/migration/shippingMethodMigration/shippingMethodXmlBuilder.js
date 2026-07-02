'use strict';

var transformer = require('*/cartridge/scripts/migration/shippingMethodMigration/shippingMethodTransformer');

var NS_SHIPPING = 'http://www.demandware.com/xml/impex/shipping/2007-03-31';

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
 * @param {string} tagName
 * @param {Array<{lang: string, value: string}>} entries
 * @param {string} indent
 * @returns {string}
 */
function buildLocalizedElementsXml(tagName, entries, indent) {
    var xml = '';
    if (!entries || !entries.length) return xml;
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry || !entry.value) continue;
        xml += indent + '<' + tagName + ' xml:lang="' + xmlEsc(entry.lang) + '">'
            + xmlEsc(entry.value) + '</' + tagName + '>\n';
    }
    return xml;
}

function buildCustomAttributesXml(method) {
    var xml  = '';
    var has  = false;
    var i;
    var j;

    var localized = method.localized_custom || [];
    for (i = 0; i < localized.length; i++) {
        var item = localized[i];
        for (j = 0; j < item.entries.length; j++) {
            if (!has) { has = true; }
            xml += '            <custom-attribute attribute-id="' + xmlEsc(item.id)
                + '" xml:lang="' + xmlEsc(item.entries[j].lang) + '">'
                + xmlEsc(item.entries[j].value) + '</custom-attribute>\n';
        }
    }

    var keys = Object.keys(method);
    for (i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k.length > 2 && k.charAt(0) === 'c' && k.charAt(1) === '_') {
            var attrId = k.slice(2);
            var val    = method[k];
            if (val !== null && val !== undefined && val !== '') {
                if (!has) { has = true; }
                xml += '            <custom-attribute attribute-id="' + xmlEsc(attrId)
                    + '" xml:lang="x-default">' + xmlEsc(val) + '</custom-attribute>\n';
            }
        }
    }

    if (!has) return '';
    return '        <custom-attributes>\n' + xml + '        </custom-attributes>\n';
}

function buildShippingMethodXml(ctpMethod) {
    var method = transformer.transformShippingMethod(ctpMethod);
    var xml    = '    <shipping-method method-id="' + xmlEsc(method.method_id) + '"'
        + ' default="' + (method.is_default ? 'true' : 'false') + '">\n';

    xml += buildLocalizedElementsXml('display-name', method.display_names, '        ');
    xml += buildLocalizedElementsXml('description', method.descriptions, '        ');
    xml += '        <online-flag>' + (method.online_flag ? 'true' : 'false') + '</online-flag>\n';
    xml += '        <tax-class-id>' + xmlEsc(method.tax_class_id || 'standard') + '</tax-class-id>\n';
    xml += '        <price-table>\n';
    xml += '            <amount order-value="0">' + xmlEsc(formatPrice(method.price)) + '</amount>\n';
    xml += '        </price-table>\n';
    xml += buildCustomAttributesXml(method);
    if (method.currency) {
        xml += '        <currency>' + xmlEsc(method.currency) + '</currency>\n';
    }
    xml += '    </shipping-method>\n';
    return xml;
}

/**
 * Build SFCC shipping import XML for a batch of CTP shipping methods.
 * @param {Array} ctpMethods
 * @returns {{ xml: string, built: number, failed: number, errors: Array }}
 */
function buildXml(ctpMethods) {
    var built  = 0;
    var failed = 0;
    var errors = [];
    var body   = '';

    for (var i = 0; i < ctpMethods.length; i++) {
        try {
            body += buildShippingMethodXml(ctpMethods[i]);
            built++;
        } catch (e) {
            failed++;
            if (errors.length < 5) {
                errors.push((ctpMethods[i].key || ctpMethods[i].id) + ': ' + (e.message || String(e)));
            }
        }
    }

    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<shipping xmlns="' + NS_SHIPPING + '">\n'
        + body
        + '</shipping>\n';

    return { xml: xml, built: built, failed: failed, errors: errors };
}

function formatPrice(val) {
    var n = parseFloat(val);
    if (isNaN(n) || n === 0) return '0';
    return n.toFixed(2);
}

module.exports = {
    buildXml:    buildXml,
    NS_SHIPPING: NS_SHIPPING
};
