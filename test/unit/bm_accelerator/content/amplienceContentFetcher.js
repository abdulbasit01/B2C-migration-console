'use strict';

/* global describe, it */

var expect = require('chai').expect;
var path = require('path');
var proxyquire = require('proxyquire').noCallThru();

var fetcherPath = path.join(
    __dirname,
    '../../../../cartridges/bm_accelerator/cartridge/scripts/migration/contentMigration/amplienceContentFetcher.js'
);

/**
 * Build a minimal Amplience content-item API fixture.
 * @param {string} id - item ID
 * @param {string} schema - schema short name
 * @returns {Object} content item
 */
function item(id, schema) {
    return {
        id: id,
        label: id,
        status: 'ACTIVE',
        body: {
            _meta: {
                schema: 'https://schemas.example/' + schema
            }
        }
    };
}

describe('Amplience content fetcher', function () {
    it('loads every repository and content-item page', function () {
        var http = {
            get: function (url) {
                if (/\/hubs$/.test(url)) {
                    return {
                        status: 200,
                        data: { _embedded: { hubs: [{ id: 'hub-1', name: 'demo' }] } }
                    };
                }
                if (/content-repositories\?page=0/.test(url)) {
                    return {
                        status: 200,
                        data: {
                            _embedded: {
                                'content-repositories': [{ id: 'repo-1', name: 'content', label: 'Content' }]
                            },
                            page: { totalPages: 2 }
                        }
                    };
                }
                if (/content-repositories\?page=1/.test(url)) {
                    return {
                        status: 200,
                        data: {
                            _embedded: {
                                'content-repositories': [{ id: 'repo-2', name: 'slots', label: 'Slots' }]
                            },
                            page: { totalPages: 2 }
                        }
                    };
                }
                if (/repo-1\/content-items\?page=0/.test(url)) {
                    return {
                        status: 200,
                        data: {
                            _embedded: { 'content-items': [item('hero-1', 'hero')] },
                            page: { totalElements: 2, totalPages: 2 }
                        }
                    };
                }
                if (/repo-1\/content-items\?page=1/.test(url)) {
                    return {
                        status: 200,
                        data: {
                            _embedded: { 'content-items': [item('hero-2', 'hero')] },
                            page: { totalElements: 2, totalPages: 2 }
                        }
                    };
                }
                if (/repo-2\/content-items\?page=0/.test(url)) {
                    return {
                        status: 200,
                        data: {
                            _embedded: { 'content-items': [item('slot-1', 'slot')] },
                            page: { totalElements: 1, totalPages: 1 }
                        }
                    };
                }
                throw new Error('Unexpected URL: ' + url);
            }
        };
        var fetcher = proxyquire(fetcherPath, {
            '*/cartridge/scripts/migration/core/amplienceApi': http,
            '*/cartridge/scripts/migration/connectors/amplience/amplienceAuth': {
                resolveCreds: function () {
                    return { hubName: 'demo', personalAccessToken: 'token' };
                },
                hasManagementCreds: function () { return true; },
                getAccessToken: function () { return { token: 'token' }; }
            },
            '*/cartridge/scripts/migration/contentMigration/amplienceCdn': {
                buildCdnUrl: function () { return ''; }
            }
        });

        var result = fetcher.listContentItems(100);

        expect(result.total).to.equal(3);
        expect(result.repositories).to.have.length(2);
        expect(result.repositories[0].count).to.equal(2);
        expect(result.repositories[1].count).to.equal(1);
        expect(result.schemas).to.deep.equal(['hero', 'slot']);
    });
});
