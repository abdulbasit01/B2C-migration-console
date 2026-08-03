'use strict';

var transformer      = require('*/cartridge/scripts/migration/customerMigration/bcCustomerTransformer');
var ctpXmlBuilder    = require('*/cartridge/scripts/migration/customerMigration/customerXmlBuilder');
var groupFetcher     = require('*/cartridge/scripts/migration/customerMigration/bcCustomerGroupFetcher');
var attrIdMapSession = require('*/cartridge/scripts/migration/core/attrIdMapSession');

var xmlEsc          = ctpXmlBuilder.xmlEsc;
var buildAddressXml = ctpXmlBuilder.buildAddressXml;
var XML_HEADER      = ctpXmlBuilder.XML_HEADER;
var XML_FOOTER      = ctpXmlBuilder.XML_FOOTER;

function resolveCustomerAttrId(canonicalId) {
    return attrIdMapSession.resolve(canonicalId, attrIdMapSession.read('customer'));
}

function customAttrXml(attrId, value) {
    return '                <custom-attribute attribute-id="' + xmlEsc(attrId) + '">' + xmlEsc(value) + '</custom-attribute>\n';
}

function customBoolAttrXml(attrId, value) {
    return '                <custom-attribute attribute-id="' + xmlEsc(attrId) + '">' + (value ? 'true' : 'false') + '</custom-attribute>\n';
}

function buildCustomerXml(bcCustomer) {
    var transformed = transformer.transformCustomer(bcCustomer);
    var profile      = transformed.profile;
    var addresses    = transformed.addresses;

    var bcId       = String(bcCustomer.id);
    var customerNo = bcId;
    var password   = require('*/cartridge/scripts/migration/core/tempPassword').generate();
    var login      = xmlEsc(profile.login || profile.email);

    var xml = '    <customer customer-no="' + xmlEsc(customerNo) + '">\n';

    xml += '        <credentials>\n';
    xml += '            <login>' + login + '</login>\n';
    xml += '            <password encrypted="false">' + xmlEsc(password) + '</password>\n';
    xml += '        </credentials>\n';

    xml += '        <profile>\n';
    if (profile.first_name) xml += '            <first-name>' + xmlEsc(profile.first_name) + '</first-name>\n';
    if (profile.last_name)  xml += '            <last-name>'  + xmlEsc(profile.last_name)  + '</last-name>\n';
    if (profile.email)      xml += '            <email>'      + xmlEsc(profile.email)      + '</email>\n';
    if (profile.phone)      xml += '            <phone-mobile>' + xmlEsc(profile.phone)     + '</phone-mobile>\n';

    xml += '            <custom-attributes>\n';
    xml += customAttrXml(resolveCustomerAttrId('bc_customer_id'), profile.c_bc_customer_id);
    if (profile.c_bc_company) {
        xml += customAttrXml(resolveCustomerAttrId('bc_company'), profile.c_bc_company);
    }
    if (profile.c_bc_notes) {
        xml += customAttrXml(resolveCustomerAttrId('bc_notes'), profile.c_bc_notes);
    }
    if (profile.c_bc_customer_group_id) {
        xml += customAttrXml(resolveCustomerAttrId('bc_customer_group_id'), profile.c_bc_customer_group_id);
    }
    if (profile.c_bc_tax_exempt_category) {
        xml += customAttrXml(resolveCustomerAttrId('bc_tax_exempt_category'), profile.c_bc_tax_exempt_category);
    }
    if (profile.c_bc_accepts_marketing !== undefined) {
        xml += customBoolAttrXml(resolveCustomerAttrId('bc_accepts_marketing'), profile.c_bc_accepts_marketing);
    }
    xml += '            </custom-attributes>\n';
    xml += '        </profile>\n';

    if (addresses.length > 0) {
        xml += '        <addresses>\n';
        for (var a = 0; a < addresses.length; a++) {
            xml += buildAddressXml(addresses[a]);
        }
        xml += '        </addresses>\n';
    }

    if (profile.c_bc_customer_group_id) {
        xml += '        <customer-groups>\n';
        xml += '            <customer-group group-id="'
            + xmlEsc(groupFetcher.groupIdForBcGroup(profile.c_bc_customer_group_id))
            + '"/>\n';
        xml += '        </customer-groups>\n';
    }

    xml += '    </customer>\n';
    return xml;
}

/**
 * Build just the <customer> element(s) for a batch — no XML header/root wrapper.
 * @param {Array} bcCustomers - raw BigCommerce customer objects
 * @returns {{ body: string, built: number, failed: number, errors: Array }}
 */
function buildCustomerFragment(bcCustomers) {
    var built  = 0;
    var failed = 0;
    var errors = [];
    var body   = '';

    for (var i = 0; i < bcCustomers.length; i++) {
        try {
            body += buildCustomerXml(bcCustomers[i]);
            built++;
        } catch (e) {
            failed++;
            if (errors.length < 5) {
                errors.push((bcCustomers[i].email || bcCustomers[i].id) + ': ' + (e.message || String(e)));
            }
        }
    }

    return { body: body, built: built, failed: failed, errors: errors };
}

module.exports = {
    buildCustomerFragment: buildCustomerFragment,
    XML_HEADER:            XML_HEADER,
    XML_FOOTER:            XML_FOOTER
};
