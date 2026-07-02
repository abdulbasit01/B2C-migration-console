'use strict';

var NS_STORE = 'http://www.demandware.com/xml/impex/store/2007-04-30';

function xmlEsc(val) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&apos;');
}

function optionalElement(tag, value) {
    if (value === null || value === undefined || value === '') return '';
    return '        <' + tag + '>' + xmlEsc(value) + '</' + tag + '>\n';
}

function buildCustomAttributes(attrs) {
    if (!attrs || typeof attrs !== 'object') return '';
    var keys = Object.keys(attrs).sort();
    if (!keys.length) return '';

    var rows = '';
    var i;
    for (i = 0; i < keys.length; i++) {
        var val = attrs[keys[i]];
        if (val === null || val === undefined || val === '') continue;
        rows += '            <custom-attribute attribute-id="' + xmlEsc(keys[i]) + '">'
            + xmlEsc(val) + '</custom-attribute>\n';
    }
    if (!rows) return '';
    return '        <custom-attributes>\n' + rows + '        </custom-attributes>\n';
}

function buildStoreXml(store) {
    var rows = '    <store store-id="' + xmlEsc(store.storeId) + '">\n'
        + '        <name>' + xmlEsc(store.name) + '</name>\n'
        + optionalElement('address1', store.address1)
        + optionalElement('city', store.city)
        + optionalElement('postal-code', store.postalCode)
        + optionalElement('state-code', store.stateCode)
        + optionalElement('country-code', store.countryCode)
        + optionalElement('email', store.email)
        + optionalElement('phone', store.phone)
        + optionalElement('fax', store.fax)
        + optionalElement('latitude', store.latitude)
        + optionalElement('longitude', store.longitude)
        + '        <store-locator-enabled-flag>' + (store.storeLocatorEnabled ? 'true' : 'false') + '</store-locator-enabled-flag>\n'
        + '        <demandware-pos-enabled-flag>' + (store.demandwarePosEnabled ? 'true' : 'false') + '</demandware-pos-enabled-flag>\n'
        + '        <pos-enabled-flag>' + (store.posEnabled ? 'true' : 'false') + '</pos-enabled-flag>\n'
        + buildCustomAttributes(store.customAttributes)
        + '    </store>\n';
    return rows;
}

/**
 * Build SFCC stores IMPEX XML matching sample-store.xml structure.
 * @param {Array} stores
 * @returns {{ xml: string, built: number, failed: number, errors: Array }}
 */
function buildXml(stores) {
    var built  = 0;
    var failed = 0;
    var errors = [];
    var body   = '';
    var i;

    var list = stores || [];
    for (i = 0; i < list.length; i++) {
        try {
            body += buildStoreXml(list[i]);
            built++;
        } catch (e) {
            failed++;
            if (errors.length < 5) errors.push('store: ' + (e.message || String(e)));
        }
    }

    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<stores xmlns="' + NS_STORE + '">\n'
        + body
        + '</stores>\n';

    return { xml: xml, built: built, failed: failed, errors: errors };
}

module.exports = {
    buildXml: buildXml,
    NS_STORE: NS_STORE
};
