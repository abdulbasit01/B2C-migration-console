'use strict';

var NS_TAX = 'http://www.demandware.com/xml/impex/tax/2007-02-14';

function xmlEsc(val) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&apos;');
}

function buildTaxClassXml(cls) {
    var defAttr = cls.isDefault ? ' default="true"' : '';
    var rows    = '        <tax-class class-id="' + xmlEsc(cls.id) + '"' + defAttr + '>\n'
        + '            <display-name>' + xmlEsc(cls.displayName) + '</display-name>\n';
    if (cls.description) {
        rows += '            <description>' + xmlEsc(cls.description) + '</description>\n';
    }
    rows += '        </tax-class>\n';
    return rows;
}

function buildJurisdictionXml(j) {
    var rows = '        <tax-jurisdiction jurisdiction-id="' + xmlEsc(j.id) + '">\n'
        + '            <display-name>' + xmlEsc(j.displayName) + '</display-name>\n';
    if (j.country) {
        rows += '            <address-mappings>\n'
            + '                <address-mapping key1="' + xmlEsc(j.country) + '" key2="' + xmlEsc(j.stateKey) + '"/>\n'
            + '            </address-mappings>\n';
    }
    rows += '        </tax-jurisdiction>\n';
    return rows;
}

function buildTaxRateXml(rate) {
    return '        <tax-rate jurisdiction-id="' + xmlEsc(rate.jurisdictionId)
        + '" class-id="' + xmlEsc(rate.classId) + '">' + xmlEsc(rate.amount) + '</tax-rate>\n';
}

/**
 * Build SFCC tax IMPEX XML matching sample-tax-table.xml structure.
 * @param {{ taxClasses: Array, jurisdictions: Array, taxRates: Array }} model
 * @returns {{ xml: string, built: number, failed: number, errors: Array }}
 */
function buildXml(model) {
    var built  = 0;
    var failed = 0;
    var errors = [];
    var classesXml = '';
    var jurisXml   = '';
    var ratesXml   = '';
    var i;

    var classes = (model && model.taxClasses) ? model.taxClasses : [];
    var juris   = (model && model.jurisdictions) ? model.jurisdictions : [];
    var rates   = (model && model.taxRates) ? model.taxRates : [];

    for (i = 0; i < classes.length; i++) {
        try {
            classesXml += buildTaxClassXml(classes[i]);
            built++;
        } catch (e) {
            failed++;
            if (errors.length < 5) errors.push('class: ' + (e.message || String(e)));
        }
    }

    for (i = 0; i < juris.length; i++) {
        try {
            jurisXml += buildJurisdictionXml(juris[i]);
            built++;
        } catch (e) {
            failed++;
            if (errors.length < 5) errors.push('jurisdiction: ' + (e.message || String(e)));
        }
    }

    for (i = 0; i < rates.length; i++) {
        try {
            ratesXml += buildTaxRateXml(rates[i]);
            built++;
        } catch (e) {
            failed++;
            if (errors.length < 5) errors.push('rate: ' + (e.message || String(e)));
        }
    }

    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<tax xmlns="' + NS_TAX + '">\n'
        + '    <tax-classes>\n'
        + classesXml
        + '    </tax-classes>\n'
        + '    <tax-jurisdictions>\n'
        + jurisXml
        + '    </tax-jurisdictions>\n'
        + '    <tax-rates>\n'
        + ratesXml
        + '    </tax-rates>\n'
        + '</tax>\n';

    return { xml: xml, built: built, failed: failed, errors: errors };
}

module.exports = {
    buildXml: buildXml,
    NS_TAX:   NS_TAX
};
