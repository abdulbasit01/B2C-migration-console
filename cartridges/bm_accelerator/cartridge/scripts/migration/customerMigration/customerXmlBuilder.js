'use strict';

var transformer = require('*/cartridge/scripts/migration/customerMigration/customerTransformer');

function xmlEsc(val) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&apos;');
}

function buildAddressXml(addr) {
    var preferred = addr.preferred ? 'true' : 'false';
    var xml = '        <address address-id="' + xmlEsc(addr.address_id) + '" preferred="' + preferred + '">\n';
    if (addr.salutation)   xml += '            <salutation>'   + xmlEsc(addr.salutation)   + '</salutation>\n';
    if (addr.first_name)   xml += '            <first-name>'   + xmlEsc(addr.first_name)   + '</first-name>\n';
    if (addr.last_name)    xml += '            <last-name>'    + xmlEsc(addr.last_name)    + '</last-name>\n';
    if (addr.company_name) xml += '            <company-name>' + xmlEsc(addr.company_name) + '</company-name>\n';
    if (addr.address1)     xml += '            <address1>'     + xmlEsc(addr.address1)     + '</address1>\n';
    if (addr.address2)     xml += '            <address2>'     + xmlEsc(addr.address2)     + '</address2>\n';
    if (addr.city)         xml += '            <city>'         + xmlEsc(addr.city)         + '</city>\n';
    if (addr.postal_code)  xml += '            <postal-code>'  + xmlEsc(addr.postal_code)  + '</postal-code>\n';
    if (addr.state_code)   xml += '            <state-code>'   + xmlEsc(addr.state_code)   + '</state-code>\n';
    if (addr.country_code) xml += '            <country-code>' + xmlEsc(addr.country_code) + '</country-code>\n';
    if (addr.phone)        xml += '            <phone>'        + xmlEsc(addr.phone)        + '</phone>\n';
    xml += '        </address>\n';
    return xml;
}

function buildCustomerXml(ctpCustomer) {
    var transformed = transformer.transformCustomer(ctpCustomer);
    var profile     = transformed.profile;
    var addresses   = transformed.addresses;

    var ctpId      = String(ctpCustomer.id);
    var customerNo = ctpId;
    var password   = 'Rc1!' + ctpId.replace(/-/g, '').substring(0, 12);
    var login      = xmlEsc(profile.login || profile.email);

    var xml = '    <customer customer-no="' + xmlEsc(customerNo) + '">\n';

    xml += '        <credentials>\n';
    xml += '            <login>' + login + '</login>\n';
    xml += '            <password encryption="none">' + xmlEsc(password) + '</password>\n';
    xml += '        </credentials>\n';

    xml += '        <profile>\n';
    if (profile.salutation)   xml += '            <salutation>'   + xmlEsc(profile.salutation)   + '</salutation>\n';
    if (profile.first_name)   xml += '            <first-name>'   + xmlEsc(profile.first_name)   + '</first-name>\n';
    if (profile.last_name)    xml += '            <last-name>'    + xmlEsc(profile.last_name)    + '</last-name>\n';
    if (profile.email)        xml += '            <email>'        + xmlEsc(profile.email)        + '</email>\n';
    if (profile.company_name) xml += '            <company-name>' + xmlEsc(profile.company_name) + '</company-name>\n';
    if (profile.birthday)     xml += '            <birthday>'     + xmlEsc(profile.birthday)     + '</birthday>\n';
    xml += '        </profile>\n';

    xml += '        <custom-attributes>\n';
    xml += '            <custom-attribute attribute-id="ctp_customer_id">' + xmlEsc(profile.c_ctp_customer_id) + '</custom-attribute>\n';
    if (profile.c_ctp_customer_number) {
        xml += '            <custom-attribute attribute-id="ctp_customer_number">' + xmlEsc(profile.c_ctp_customer_number) + '</custom-attribute>\n';
        xml += '            <custom-attribute attribute-id="CTCustomerId">' + xmlEsc(profile.c_ctp_customer_number) + '</custom-attribute>\n';
    }
    if (profile.c_ctp_external_id)  xml += '            <custom-attribute attribute-id="ctp_external_id">'  + xmlEsc(profile.c_ctp_external_id)  + '</custom-attribute>\n';
    if (profile.c_ctp_vat_id)       xml += '            <custom-attribute attribute-id="ctp_vat_id">'       + xmlEsc(profile.c_ctp_vat_id)       + '</custom-attribute>\n';
    if (profile.c_ctp_locale)       xml += '            <custom-attribute attribute-id="ctp_locale">'       + xmlEsc(profile.c_ctp_locale)       + '</custom-attribute>\n';
    if (profile.c_ctp_middle_name)  xml += '            <custom-attribute attribute-id="ctp_middle_name">'  + xmlEsc(profile.c_ctp_middle_name)  + '</custom-attribute>\n';
    xml += '        </custom-attributes>\n';

    if (addresses.length > 0) {
        xml += '        <addresses>\n';
        for (var a = 0; a < addresses.length; a++) {
            xml += buildAddressXml(addresses[a]);
        }
        xml += '        </addresses>\n';
    }

    // Include customer group assignment — CTP group UUID used directly as SFCC group ID
    if (ctpCustomer.customerGroup && ctpCustomer.customerGroup.id) {
        xml += '        <customer-groups>\n';
        xml += '            <customer-group group-id="' + xmlEsc(ctpCustomer.customerGroup.id) + '"/>\n';
        xml += '        </customer-groups>\n';
    }

    xml += '    </customer>\n';
    return xml;
}

var XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n'
               + '<customers xmlns="http://www.demandware.com/xml/impex/customer/2006-10-31">\n';
var XML_FOOTER = '</customers>\n';

/**
 * Build just the <customer> element(s) for a batch — no XML header/root wrapper.
 * Used so multiple batches can be concatenated into a single IMPEX file.
 * @param {Array} ctpCustomers - raw CTP customer objects from ctpCustomerFetcher
 * @returns {{ body: string, built: number, failed: number, errors: Array }}
 */
function buildCustomerFragment(ctpCustomers) {
    var built  = 0;
    var failed = 0;
    var errors = [];
    var body   = '';

    for (var i = 0; i < ctpCustomers.length; i++) {
        try {
            body += buildCustomerXml(ctpCustomers[i]);
            built++;
        } catch (e) {
            failed++;
            if (errors.length < 5) {
                errors.push((ctpCustomers[i].email || ctpCustomers[i].id) + ': ' + (e.message || String(e)));
            }
        }
    }

    return { body: body, built: built, failed: failed, errors: errors };
}

/**
 * Build SFCC customer import XML for a batch of CTP customer objects.
 * @param {Array} ctpCustomers - raw CTP customer objects from ctpCustomerFetcher
 * @returns {{ xml: string, built: number, failed: number, errors: Array }}
 */
function buildXml(ctpCustomers) {
    var fragment = buildCustomerFragment(ctpCustomers);
    return {
        xml:    XML_HEADER + fragment.body + XML_FOOTER,
        built:  fragment.built,
        failed: fragment.failed,
        errors: fragment.errors
    };
}

module.exports = {
    buildXml:             buildXml,
    buildCustomerFragment: buildCustomerFragment,
    XML_HEADER:           XML_HEADER,
    XML_FOOTER:           XML_FOOTER
};
