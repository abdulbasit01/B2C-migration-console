'use strict';

/**
 * SFCC Job Step — Import CTP customers from XML files in the Impex directory.
 *
 * This runs in job context (no @SF quota), so CustomerMgr.createCustomer()
 * can be called for every customer without hitting the 2-per-request limit.
 *
 * Setup (one-time in BM):
 *   Administration → Operations → Jobs → New Job
 *   Add step type: bm_accelerator/cartridge/scripts/jobsteps/importCtpCustomers
 *   Set CustomerListID parameter (or leave blank — Phase 1 writes config.json automatically)
 *   Save the job with a known ID (e.g. "CTP-Customer-Import")
 */

var File               = require('dw/io/File');
var FileReader         = require('dw/io/FileReader');
var XMLStreamReader    = require('dw/io/XMLStreamReader');
var XMLStreamConstants = require('dw/io/XMLStreamConstants');
var Status             = require('dw/system/Status');
var Transaction        = require('dw/system/Transaction');
var CustomerMgr        = require('dw/customer/CustomerMgr');
var Logger             = require('dw/system/Logger');

var log = Logger.getLogger('ctp-migration', 'CustomerImport');

/**
 * Job step entry point — called by the SFCC job scheduler.
 * @param {dw.util.HashMap} args - job step parameters
 * @returns {dw.system.Status}
 */
function execute(args) {
    var importDir = (args.ImportDirectory && String(args.ImportDirectory).trim()) || 'ctp-migration';
    var listId    = (args.CustomerListID  && String(args.CustomerListID).trim())  || null;

    // Phase 1 writes config.json so the job always targets the correct list
    var configFile = new File(File.IMPEX + File.SEPARATOR + 'src' + File.SEPARATOR + 'instance' + File.SEPARATOR + importDir + File.SEPARATOR + 'config.json');
    if (configFile.exists()) {
        var cfr = null;
        try {
            cfr = new FileReader(configFile, 'UTF-8');
            var line = cfr.readLine();
            if (line) {
                var cfg = JSON.parse(line);
                if (cfg.listId) { listId = cfg.listId; }
            }
        } catch (ce) {
            log.warn('Could not read config.json: ' + ce.message);
        } finally {
            if (cfr) { try { cfr.close(); } catch (e) {} }
        }
    }

    if (!listId) {
        log.error('CustomerListID is not set. Run Phase 1 of the migration tool first, or set it as a job parameter.');
        return new Status(Status.ERROR, 'MISSING_PARAM', 'CustomerListID not set');
    }

    var customerList = CustomerMgr.getCustomerList(listId);
    if (!customerList) {
        log.error('Customer list not found: ' + listId);
        return new Status(Status.ERROR, 'NOT_FOUND', 'Customer list not found: ' + listId);
    }

    var dir = new File(File.IMPEX + File.SEPARATOR + 'src' + File.SEPARATOR + 'instance' + File.SEPARATOR + importDir);
    if (!dir.exists() || !dir.isDirectory()) {
        log.error('Import directory not found: ' + importDir);
        return new Status(Status.ERROR, 'NOT_FOUND', 'Directory not found: ' + importDir);
    }

    var files        = dir.listFiles();
    var totalCreated = 0;
    var totalSkipped = 0;
    var totalFailed  = 0;

    if (files) {
        var fileCount = (typeof files.size === 'function') ? files.size() : files.length;
        for (var fi = 0; fi < fileCount; fi++) {
            var f    = (typeof files.get === 'function') ? files.get(fi) : files[fi];
            var name = f.getName();
            if (name.indexOf('.xml') < 0) { continue; }

            log.info('Processing: ' + name);
            var result = processXmlFile(f, customerList);
            totalCreated += result.created;
            totalSkipped += result.skipped;
            totalFailed  += result.failed;
            log.info('  ' + name + ': ' + result.created + ' created, ' + result.skipped + ' skipped, ' + result.failed + ' failed');
        }
    }

    var summary = 'Import complete: ' + totalCreated + ' created, ' + totalSkipped + ' skipped, ' + totalFailed + ' failed';
    log.info(summary);
    return new Status(Status.OK, 'OK', summary);
}

// ─── XML file processor ───────────────────────────────────────────────────────

function processXmlFile(file, customerList) {
    var created = 0;
    var skipped = 0;
    var failed  = 0;
    var fr      = null;
    var xsr     = null;

    try {
        fr  = new FileReader(file, 'UTF-8');
        xsr = new XMLStreamReader(fr);

        var customer  = null;
        var address   = null;
        var attrId    = null;
        var inCreds   = false;
        var inProfile = false;
        var inAttrs   = false;
        var inAddress = false;
        var textBuf   = '';
        var ev, ln, txt;

        while (xsr.hasNext()) {
            ev = xsr.next();

            if (ev === XMLStreamConstants.START_ELEMENT) {
                ln      = xsr.getLocalName();
                textBuf = '';

                if (ln === 'customer') {
                    customer  = {
                        customerNo:  xsr.getAttributeValue(null, 'customer-no') || '',
                        login:       '',
                        password:    '',
                        firstName:   '',
                        lastName:    '',
                        email:       '',
                        salutation:  '',
                        companyName: '',
                        birthday:    '',
                        customAttrs: {},
                        addresses:   []
                    };
                    inCreds = false; inProfile = false; inAttrs = false; inAddress = false;
                } else if (ln === 'credentials')     { inCreds   = true; }
                else if (ln === 'profile')            { inProfile = true; }
                else if (ln === 'custom-attributes')  { inAttrs   = true; }
                else if (ln === 'custom-attribute')   { attrId = xsr.getAttributeValue(null, 'attribute-id'); }
                else if (ln === 'address' && customer) {
                    inAddress = true;
                    address   = {
                        addressId:   xsr.getAttributeValue(null, 'address-id') || 'imported',
                        preferred:   xsr.getAttributeValue(null, 'preferred') === 'true',
                        firstName: '', lastName: '', salutation: '', companyName: '',
                        address1:  '', address2: '', city:       '', postalCode:  '',
                        countryCode: '', stateCode: '', phone: ''
                    };
                }

            } else if (ev === XMLStreamConstants.END_ELEMENT) {
                ln  = xsr.getLocalName();
                txt = textBuf.trim();

                // Fill customer credential fields
                if (customer && inCreds) {
                    if (ln === 'login')    { customer.login    = txt; }
                    if (ln === 'password') { customer.password = txt; }
                }
                // Fill customer profile fields
                if (customer && inProfile) {
                    if (ln === 'first-name')   { customer.firstName   = txt; }
                    if (ln === 'last-name')    { customer.lastName    = txt; }
                    if (ln === 'email')        { customer.email       = txt; }
                    if (ln === 'salutation')   { customer.salutation  = txt; }
                    if (ln === 'company-name') { customer.companyName = txt; }
                    if (ln === 'birthday')     { customer.birthday    = txt; }
                }
                // Fill custom attributes
                if (customer && inAttrs && attrId && ln === 'custom-attribute') {
                    customer.customAttrs[attrId] = txt;
                }
                // Fill address fields
                if (customer && inAddress && address) {
                    if (ln === 'first-name')   { address.firstName   = txt; }
                    if (ln === 'last-name')    { address.lastName    = txt; }
                    if (ln === 'salutation')   { address.salutation  = txt; }
                    if (ln === 'company-name') { address.companyName = txt; }
                    if (ln === 'address1')     { address.address1    = txt; }
                    if (ln === 'address2')     { address.address2    = txt; }
                    if (ln === 'city')         { address.city        = txt; }
                    if (ln === 'postal-code')  { address.postalCode  = txt; }
                    if (ln === 'country-code') { address.countryCode = txt; }
                    if (ln === 'state-code')   { address.stateCode   = txt; }
                    if (ln === 'phone')        { address.phone       = txt; }
                }

                // Close contexts
                if (ln === 'credentials')       { inCreds   = false; }
                if (ln === 'profile')           { inProfile = false; }
                if (ln === 'custom-attributes') { inAttrs   = false; }
                if (ln === 'custom-attribute')  { attrId    = null;  }
                if (ln === 'address' && address && customer) {
                    customer.addresses.push(address);
                    address = null; inAddress = false;
                }
                if (ln === 'customer' && customer) {
                    var res = createSfccCustomer(customer, customerList);
                    if (res === 'created')      { created++; }
                    else if (res === 'skipped') { skipped++; }
                    else                        { failed++;  }
                    customer = null;
                }

                textBuf = '';

            } else if (ev === XMLStreamConstants.CHARACTERS) {
                textBuf += xsr.getText();
            }
        }
    } catch (e) {
        log.error('Error parsing ' + file.getName() + ': ' + (e.message || String(e)));
    } finally {
        if (xsr) { try { xsr.close(); } catch (e) {} }
        if (fr)  { try { fr.close();  } catch (e) {} }
    }

    return { created: created, skipped: skipped, failed: failed };
}

// ─── Single-customer creation ─────────────────────────────────────────────────

function createSfccCustomer(cust, customerList) {
    if (!cust.login) { return 'skipped'; }

    try {
        Transaction.begin();

        var sfccCustomer = CustomerMgr.createCustomer(cust.login, cust.password || 'Rc1!TempPass1', customerList);
        if (!sfccCustomer) { Transaction.rollback(); return 'failed'; }

        var p = sfccCustomer.getProfile();
        if (cust.firstName)   { p.setFirstName(cust.firstName);   }
        if (cust.lastName)    { p.setLastName(cust.lastName);     }
        if (cust.email)       { p.setEmail(cust.email);           }
        if (cust.salutation)  { p.setSalutation(cust.salutation); }
        if (cust.companyName) { p.setCompanyName(cust.companyName); }
        if (cust.birthday) {
            try {
                var parts = String(cust.birthday).split('-');
                p.setBirthday(new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
            } catch (be) {}
        }

        try {
            var attrKeys = Object.keys(cust.customAttrs);
            for (var ak = 0; ak < attrKeys.length; ak++) {
                p.custom[attrKeys[ak]] = cust.customAttrs[attrKeys[ak]];
            }
        } catch (ce) {}

        // Addresses
        var book = sfccCustomer.getAddressBook();
        for (var ai = 0; ai < cust.addresses.length; ai++) {
            var a = cust.addresses[ai];
            try {
                var sfccAddr = book.getAddress(a.addressId) || book.createAddress(a.addressId);
                if (a.firstName)   { sfccAddr.setFirstName(a.firstName);     }
                if (a.lastName)    { sfccAddr.setLastName(a.lastName);       }
                if (a.salutation)  { sfccAddr.setSalutation(a.salutation);   }
                if (a.companyName) { sfccAddr.setCompanyName(a.companyName); }
                if (a.address1)    { sfccAddr.setAddress1(a.address1);       }
                if (a.address2)    { sfccAddr.setAddress2(a.address2);       }
                if (a.city)        { sfccAddr.setCity(a.city);               }
                if (a.postalCode)  { sfccAddr.setPostalCode(a.postalCode);   }
                if (a.countryCode) { sfccAddr.setCountryCode(a.countryCode); }
                if (a.stateCode)   { sfccAddr.setStateCode(a.stateCode);     }
                if (a.phone)       { sfccAddr.setPhone(a.phone);             }
                if (a.preferred)   { book.setPreferredAddress(sfccAddr);     }
            } catch (ae) {
                log.warn('Address creation failed for ' + cust.login + ': ' + ae.message);
            }
        }

        Transaction.commit();
        return 'created';

    } catch (e) {
        try { Transaction.rollback(); } catch (re) {}
        var msg = (e.message || String(e)).toLowerCase();
        if (msg.indexOf('exist') >= 0 || msg.indexOf('duplicate') >= 0 || msg.indexOf('already') >= 0 || msg.indexOf('login') >= 0) {
            return 'skipped';
        }
        log.error('Failed to create ' + cust.login + ': ' + (e.message || String(e)));
        return 'failed';
    }
}

module.exports = { execute: execute };
