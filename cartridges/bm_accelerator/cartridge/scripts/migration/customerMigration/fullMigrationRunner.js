'use strict';

var fetcher      = require('*/cartridge/scripts/migration/customerMigration/ctpCustomerFetcher');
var xmlBuilder   = require('*/cartridge/scripts/migration/customerMigration/customerXmlBuilder');
var uploader     = require('*/cartridge/scripts/migration/customerMigration/webDavUploader');
var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var sfccClient   = require('*/cartridge/scripts/migration/sfccClient');

var MODULE_KEY = 'customer';
var BATCH_SIZE = 500;

var FULL_CUSTOM_ATTRS = [
    { id: 'ctp_customer_id',     display: 'CTP Customer ID'     },
    { id: 'ctp_customer_number', display: 'CTP Customer Number' },
    { id: 'ctp_external_id',     display: 'CTP External ID'     },
    { id: 'CTCustomerId',        display: 'CT Customer ID'      }
];

var CTP_ATTR_GROUP_ID   = 'CTPMigration';
var CTP_ATTR_GROUP_NAME = 'CTP Migration';

function ensureAttributes() {
    try {
        var token = sfccClient.getSFCCToken();
        try { sfccClient.ensureAttributeGroup(token, 'Profile', CTP_ATTR_GROUP_ID, CTP_ATTR_GROUP_NAME); } catch (ge) {}
        for (var i = 0; i < FULL_CUSTOM_ATTRS.length; i++) {
            var a = FULL_CUSTOM_ATTRS[i];
            try {
                sfccClient.createAttributeDefinition(token, 'Profile', {
                    id: a.id, value_type: 'string', mandatory: false,
                    searchable: false, externally_defined: false,
                    externally_managed: false, order_required: false,
                    display_name: { 'default': a.display }
                });
                try { sfccClient.addAttributeToGroup(token, 'Profile', CTP_ATTR_GROUP_ID, a.id); } catch (age) {}
            } catch (e) { /* already exists */ }
        }
    } catch (te) { /* non-fatal */ }
}

function runBatch(offset, listId) {
    if (!listId) return { ok: false, error: 'listId is required' };

    if (offset === 0) { ensureAttributes(); }

    var batch     = fetcher.fetchBatch(offset, BATCH_SIZE);
    var customers = batch.results;
    var total     = batch.total;

    if (!customers || customers.length === 0) {
        return {
            ok: true, total: total, nextOffset: offset, done: true,
            built: 0, failed: 0, errors: [],
            impexPath: fileResolver.getRelativePath(MODULE_KEY)
        };
    }

    var buildResult = xmlBuilder.buildXml(customers);
    var dirResult   = uploader.ensureDirectory();
    if (!dirResult.ok) {
        return { ok: false, error: 'WebDAV directory creation failed: ' + dirResult.error };
    }

    var runDate  = fileResolver.getRunDate(MODULE_KEY, offset);
    var fileName = fileResolver.resolveXmlFileName(MODULE_KEY, offset, BATCH_SIZE, 'webdav');
    var impexPath = fileResolver.getRelativePath(MODULE_KEY);

    if (offset === 0) {
        uploader.uploadFile('config.json', JSON.stringify({
            listId:    listId,
            module:    MODULE_KEY,
            runDate:   runDate,
            impexPath: impexPath
        }), 'application/json; charset=UTF-8');
    }

    var putResult = uploader.uploadFile(fileName, buildResult.xml);
    if (!putResult.ok) {
        return { ok: false, error: 'WebDAV upload failed: ' + putResult.error };
    }

    var nextOffset = offset + customers.length;
    return {
        ok:         true,
        total:      total,
        nextOffset: nextOffset,
        done:       nextOffset >= total || customers.length === 0,
        built:      buildResult.built,
        failed:     buildResult.failed,
        errors:     buildResult.errors,
        fileName:   fileName,
        runDate:    runDate,
        impexPath:  impexPath
    };
}

module.exports = { runBatch: runBatch };
