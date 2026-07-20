'use strict';

var transformer      = require('*/cartridge/scripts/migration/customerMigration/shopifyCustomerTransformer');
var ctpXmlBuilder    = require('*/cartridge/scripts/migration/customerMigration/customerXmlBuilder');
var groupFetcher     = require('*/cartridge/scripts/migration/customerMigration/shopifyCustomerGroupFetcher');
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

function buildCustomerXml(shopifyCustomer) {
    var transformed = transformer.transformCustomer(shopifyCustomer);
    var profile      = transformed.profile;
    var addresses    = transformed.addresses;

    var shopifyId  = String(shopifyCustomer.id);
    var customerNo = shopifyId;
    var password   = 'Rc1!' + shopifyId.substring(0, 12);
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

    // custom-attributes belongs to the Profile system object — nested inside <profile>, last child
    xml += '            <custom-attributes>\n';
    xml += customAttrXml(resolveCustomerAttrId('shopify_customer_id'), profile.c_shopify_customer_id);
    if (profile.c_shopify_note) {
        xml += customAttrXml(resolveCustomerAttrId('shopify_note'), profile.c_shopify_note);
    }
    if (profile.c_shopify_verified_email !== undefined) {
        xml += customBoolAttrXml(resolveCustomerAttrId('shopify_verified_email'), profile.c_shopify_verified_email);
    }
    if (profile.c_shopify_accepts_marketing !== undefined) {
        xml += customBoolAttrXml(resolveCustomerAttrId('shopify_accepts_marketing'), profile.c_shopify_accepts_marketing);
    }
    if (profile.c_shopify_orders_count !== undefined) {
        xml += customAttrXml(resolveCustomerAttrId('shopify_orders_count'), profile.c_shopify_orders_count);
    }
    if (profile.c_shopify_total_spent !== undefined) {
        xml += customAttrXml(resolveCustomerAttrId('shopify_total_spent'), profile.c_shopify_total_spent);
    }
    if (profile.c_shopify_tags && profile.c_shopify_tags.length) {
        xml += '                <custom-attribute attribute-id="' + xmlEsc(resolveCustomerAttrId('shopify_tags')) + '">\n';
        for (var t = 0; t < profile.c_shopify_tags.length; t++) {
            xml += '                    <value>' + xmlEsc(profile.c_shopify_tags[t]) + '</value>\n';
        }
        xml += '                </custom-attribute>\n';
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

    // Shopify has no direct customer-group concept — one SFCC group per tag instead.
    if (profile.c_shopify_tags && profile.c_shopify_tags.length) {
        xml += '        <customer-groups>\n';
        for (var g = 0; g < profile.c_shopify_tags.length; g++) {
            xml += '            <customer-group group-id="' + xmlEsc(groupFetcher.groupIdForTag(profile.c_shopify_tags[g])) + '"/>\n';
        }
        xml += '        </customer-groups>\n';
    }

    xml += '    </customer>\n';
    return xml;
}

/**
 * Build just the <customer> element(s) for a batch — no XML header/root wrapper.
 * @param {Array} shopifyCustomers - raw Shopify customer objects
 * @returns {{ body: string, built: number, failed: number, errors: Array }}
 */
function buildCustomerFragment(shopifyCustomers) {
    var built  = 0;
    var failed = 0;
    var errors = [];
    var body   = '';

    for (var i = 0; i < shopifyCustomers.length; i++) {
        try {
            body += buildCustomerXml(shopifyCustomers[i]);
            built++;
        } catch (e) {
            failed++;
            if (errors.length < 5) {
                errors.push((shopifyCustomers[i].email || shopifyCustomers[i].id) + ': ' + (e.message || String(e)));
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
