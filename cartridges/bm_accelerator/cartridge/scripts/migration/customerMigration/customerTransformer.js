'use strict';

/**
 * Transform a CTP address into an SFCC address payload.
 * CTP: streetNumber + streetName → SFCC address1
 * @param {Object}  addr        - CTP address object
 * @param {boolean} isPreferred - whether to mark as preferred shipping address
 * @returns {Object|null} SFCC address payload, or null if addr is falsy
 */
function transformAddress(addr, isPreferred) {
    if (!addr) return null;

    var sfccAddr = {
        address_id: addr.id || addr.key || ('ctp-' + addr.country + '-' + (addr.postalCode || '0')),
        preferred:  !!isPreferred
    };

    if (addr.firstName)   sfccAddr.first_name   = addr.firstName;
    if (addr.lastName)    sfccAddr.last_name     = addr.lastName;
    if (addr.salutation)  sfccAddr.salutation    = addr.salutation;
    if (addr.company)     sfccAddr.company_name  = addr.company;

    // CTP stores street as streetNumber + streetName (number-first in some locales)
    var street = '';
    if (addr.streetNumber) street = addr.streetNumber + ' ';
    if (addr.streetName)   street += addr.streetName;
    if (street.trim())     sfccAddr.address1 = street.trim();

    if (addr.additionalStreetInfo) sfccAddr.address2 = addr.additionalStreetInfo;
    if (addr.city)       sfccAddr.city        = addr.city;
    if (addr.postalCode) sfccAddr.postal_code = addr.postalCode;
    if (addr.country)    sfccAddr.country_code = addr.country;

    // CTP uses region or state for the state/province field
    if (addr.state)  sfccAddr.state_code = addr.state;
    if (addr.region && !sfccAddr.state_code) sfccAddr.state_code = addr.region;

    if (addr.phone)  sfccAddr.phone = addr.phone;
    if (addr.mobile && !sfccAddr.phone) sfccAddr.phone = addr.mobile;

    return sfccAddr;
}

/**
 * Transform a CTP customer record into SFCC customer creation payloads.
 * @param {Object} ctpCustomer - CTP customer object
 * @returns {{ profile: Object, addresses: Array }}
 *   profile   - customer fields for SFCC POST /customer_lists/{id}/customers
 *   addresses - array of SFCC address payloads for address migration phase
 */
function transformCustomer(ctpCustomer) {
    if (!ctpCustomer || !ctpCustomer.email) {
        throw new Error('CTP customer missing required email field (id: ' + (ctpCustomer && ctpCustomer.id) + ')');
    }

    var profile = {
        email: ctpCustomer.email,
        login: ctpCustomer.email
    };

    if (ctpCustomer.firstName)   profile.first_name   = ctpCustomer.firstName;
    if (ctpCustomer.lastName)    profile.last_name     = ctpCustomer.lastName;
    if (ctpCustomer.companyName) profile.company_name  = ctpCustomer.companyName;
    if (ctpCustomer.dateOfBirth) profile.birthday      = ctpCustomer.dateOfBirth;

    // CTP salutation and title both map to SFCC salutation (title takes precedence if salutation absent)
    if (ctpCustomer.salutation)                       profile.salutation = ctpCustomer.salutation;
    else if (ctpCustomer.title)                       profile.salutation = ctpCustomer.title;

    // Store CTP identifiers as custom attributes for traceability after migration
    profile.c_ctp_customer_id = ctpCustomer.id;
    if (ctpCustomer.customerNumber) {
        profile.c_ctp_customer_number = ctpCustomer.customerNumber;
        profile.c_CTCustomerId        = ctpCustomer.customerNumber;
    }
    if (ctpCustomer.externalId) profile.c_ctp_external_id = ctpCustomer.externalId;

    // Map CTP custom fields → SFCC custom attributes (requires matching attr definitions in SFCC)
    if (ctpCustomer.custom && ctpCustomer.custom.fields) {
        var fields = ctpCustomer.custom.fields;
        var keys   = Object.keys(fields);
        for (var i = 0; i < keys.length; i++) {
            var val = fields[keys[i]];
            if (val !== null && val !== undefined) {
                profile['c_' + keys[i]] = val;
            }
        }
    }

    // Transform addresses
    var addresses     = [];
    var ctpAddresses  = ctpCustomer.addresses || [];
    var defaultShipId = ctpCustomer.defaultShippingAddressId;

    for (var a = 0; a < ctpAddresses.length; a++) {
        var isPreferred = defaultShipId && defaultShipId === ctpAddresses[a].id;
        var sfccAddr    = transformAddress(ctpAddresses[a], isPreferred);
        if (sfccAddr) addresses.push(sfccAddr);
    }

    return { profile: profile, addresses: addresses };
}

module.exports = { transformCustomer: transformCustomer, transformAddress: transformAddress };
