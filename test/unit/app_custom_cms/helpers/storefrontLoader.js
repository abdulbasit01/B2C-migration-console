'use strict';

/**
 * Resolve app_custom_cms cartridge module paths for Node/Mocha unit tests.
 */
var Module = require('module');
var path   = require('path');
var fs     = require('fs');

var CARTRIDGE_ROOT = path.resolve(__dirname, '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/app_custom_cms/cartridge');
var MOCK_ROOT      = path.resolve(__dirname, '../mocks');
var originalResolve = Module._resolveFilename;
var installed = false;

function installCartridgeResolver() {
    if (installed) return;
    installed = true;

    Module._resolveFilename = function (request, parent, isMain, options) {
        if (request.indexOf('dw/') === 0) {
            var mockPath = path.join(MOCK_ROOT, request + '.js');
            if (fs.existsSync(mockPath)) {
                return originalResolve.call(this, mockPath, parent, isMain, options);
            }
        }
        if (request.indexOf('*/cartridge/') === 0) {
            var mapped = path.join(CARTRIDGE_ROOT, request.replace('*/cartridge/', ''));
            return originalResolve.call(this, mapped, parent, isMain, options);
        }
        return originalResolve.call(this, request, parent, isMain, options);
    };
}

function requireHelper(relativePath) {
    installCartridgeResolver();
    return require('*/cartridge/scripts/helpers/' + relativePath);
}

module.exports = {
    installCartridgeResolver: installCartridgeResolver,
    requireHelper:            requireHelper
};
