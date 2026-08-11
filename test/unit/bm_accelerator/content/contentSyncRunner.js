'use strict';

/* global describe, it, beforeEach */

var expect = require('chai').expect;
var path = require('path');
var Module = require('module');

var CARTRIDGE_ROOT = path.resolve(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge'
);
var originalResolve = Module._resolveFilename;
var installed = false;

function installResolver() {
    if (installed) return;
    installed = true;
    Module._resolveFilename = function (request, parent, isMain, options) {
        if (request.indexOf('*/cartridge/') === 0) {
            var mapped = path.join(CARTRIDGE_ROOT, request.replace('*/cartridge/', ''));
            return originalResolve.call(this, mapped, parent, isMain, options);
        }
        return originalResolve.call(this, request, parent, isMain, options);
    };
}

describe('contentSyncRunner', function () {
    var ContentMgr;
    var syncRunner;

    beforeEach(function () {
        installResolver();
        ContentMgr = {
            getFolder: function () { return null; }
        };
        Module._cache[require.resolve('dw/content/ContentMgr')] = {
            exports: ContentMgr
        };
        delete require.cache[path.join(CARTRIDGE_ROOT, 'scripts/migration/contentMigration/contentSyncRunner.js')];
        syncRunner = require(path.join(
            CARTRIDGE_ROOT,
            'scripts/migration/contentMigration/contentSyncRunner.js'
        ));
    });

    it('returns an error when the migrated folder is missing', function () {
        var result = syncRunner.listMigratedRefs('amplience');
        expect(result.ok).to.equal(false);
        expect(result.error).to.contain('not found');
    });

    it('collects Amplience content ids from migrated SFCC assets', function () {
        ContentMgr.getFolder = function () {
            return {
                ID: 'amplience',
                displayName: 'Amplience Migrated',
                getOnlineContent: function () {
                    return {
                        iterator: function () {
                            var items = [{
                                online: true,
                                custom: {
                                    amplienceContentId: '11111111-1111-1111-1111-111111111111',
                                    amplienceDeliveryKey: 'page/jackets'
                                }
                            }];
                            var index = 0;
                            return {
                                hasNext: function () { return index < items.length; },
                                next: function () { return items[index++]; }
                            };
                        }
                    };
                }
            };
        };

        var result = syncRunner.listMigratedRefs('amplience');
        expect(result.ok).to.equal(true);
        expect(result.contentIds).to.deep.equal(['11111111-1111-1111-1111-111111111111']);
        expect(result.deliveryKeys).to.deep.equal([]);
        expect(result.total).to.equal(1);
    });
});
