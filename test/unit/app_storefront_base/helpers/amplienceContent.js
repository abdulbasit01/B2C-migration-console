'use strict';

/* global describe, it, beforeEach */

var expect = require('chai').expect;
var loader = require('./storefrontLoader');
var ContentMgr = require('../mocks/dw/content/ContentMgr');

loader.installCartridgeResolver();

var amplienceContent = loader.requireHelper('amplienceContent');

describe('amplienceContent storefront helper', function () {
    beforeEach(function () {
        ContentMgr.__reset();
    });

    it('maps mainBanner attributes from a content asset', function () {
        var asset = {
            ID: 'amp-hero-banner',
            name: 'Hero Banner',
            online: true,
            custom: {
                amplienceWidgetType: 'mainBanner',
                amplienceDeliveryKey: 'hero/banner',
                amplienceImageUrl: 'https://cdn.example.com/hero.png',
                amplienceWidgetAttributes: JSON.stringify({
                    heading: '<h1>New Season</h1>',
                    image: 'https://cdn.example.com/hero.png'
                }),
                body: '<p></p>'
            }
        };

        var model = amplienceContent.resolveFromContentAsset(asset);

        expect(model.widgetType).to.equal('mainBanner');
        expect(model.imageUrl).to.equal('https://cdn.example.com/hero.png');
        expect(model.heading).to.equal('<h1>New Season</h1>');
        expect(model.deliveryKey).to.equal('hero/banner');
    });

    it('falls back to previewFields for amplienceWidget assets', function () {
        var asset = {
            ID: 'amp-hotspot-1',
            name: 'Hotspot',
            online: true,
            custom: {
                amplienceWidgetType: 'amplienceWidget',
                amplienceWidgetAttributes: JSON.stringify({
                    previewFields: [
                        { name: 'title', type: 'text', value: 'Shop the look' },
                        { name: 'hero', type: 'image', value: 'https://cdn.example.com/hotspot.png' }
                    ]
                }),
                body: '<p></p>'
            }
        };

        var model = amplienceContent.resolveFromContentAsset(asset);

        expect(model.widgetType).to.equal('amplienceWidget');
        expect(model.fields).to.have.lengthOf(2);
        expect(model.fields[1].value).to.equal('https://cdn.example.com/hotspot.png');
    });

    it('loads assets by content ID via ContentMgr', function () {
        ContentMgr.__setContent('amp-mens-fashion', {
            ID: 'amp-mens-fashion',
            name: 'Mens Fashion',
            online: true,
            custom: {
                amplienceWidgetType: 'editorialRichText',
                body: '<p>Trending now</p>'
            }
        });

        var model = amplienceContent.getAmplienceAsset('amp-mens-fashion');

        expect(model.id).to.equal('amp-mens-fashion');
        expect(model.bodyHtml).to.equal('<p>Trending now</p>');
    });

    it('sanitizes delivery keys to exported content IDs', function () {
        expect(amplienceContent.sanitizeDeliveryKeyToContentId('mens/fashion'))
            .to.equal('amp-mens-fashion');
    });

    it('returns null for offline assets', function () {
        var model = amplienceContent.resolveFromContentAsset({
            ID: 'amp-offline',
            online: false,
            custom: { body: '<p>Hidden</p>' }
        });

        expect(model).to.equal(null);
    });

    it('loads, filters, and paginates assets from the Amplience folder', function () {
        var assets = [
            {
                ID: 'amp-z-banner',
                name: 'Z Banner',
                online: true,
                custom: {
                    amplienceWidgetType: 'mainBanner',
                    amplienceWidgetAttributes: '{}'
                }
            },
            {
                ID: 'amp-a-editorial',
                name: 'A Editorial',
                online: true,
                custom: {
                    amplienceWidgetType: 'editorialRichText',
                    amplienceWidgetAttributes: '{}'
                }
            },
            {
                ID: 'amp-b-banner',
                name: 'B Banner',
                online: true,
                custom: {
                    amplienceWidgetType: 'mainBanner',
                    amplienceWidgetAttributes: '{}'
                }
            }
        ];

        ContentMgr.__setFolder('amplience', {
            online: true,
            getOnlineContent: function () {
                return assets;
            }
        });

        var result = amplienceContent.getAmplienceAssets({
            type: 'mainBanner',
            page: 1,
            pageSize: 1
        });

        expect(result.folderFound).to.equal(true);
        expect(result.total).to.equal(2);
        expect(result.pageCount).to.equal(2);
        expect(result.items[0].id).to.equal('amp-b-banner');
        expect(result.hasNext).to.equal(true);
    });

    it('reports when the assigned library has no Amplience folder', function () {
        var result = amplienceContent.getAmplienceAssets();

        expect(result.folderFound).to.equal(false);
        expect(result.items).to.deep.equal([]);
    });

    it('extracts fallback fields from source JSON when mapped fields are empty', function () {
        var model = amplienceContent.resolveFromContentAsset({
            ID: 'amp-source-only',
            name: 'Source Only',
            online: true,
            custom: {
                amplienceWidgetType: 'amplienceWidget',
                amplienceWidgetAttributes: '{}',
                amplienceSourceJson: JSON.stringify({
                    item: {
                        content: {
                            title: 'Summer collection',
                            image: {
                                defaultHost: 'cdn.example.com',
                                endpoint: 'content',
                                name: 'summer'
                            }
                        }
                    }
                }),
                body: '<p></p>'
            }
        });

        expect(model.fields[0].value).to.equal('Summer collection');
        expect(model.fields[1].type).to.equal('image');
        expect(model.imageUrl).to.equal('https://cdn.example.com/i/content/summer');
    });

    it('unwraps Amplience localized-value source JSON for rendering', function () {
        var model = amplienceContent.resolveFromContentAsset({
            ID: 'amp-localized',
            name: 'Localized Value',
            online: true,
            custom: {
                amplienceWidgetType: 'amplienceWidget',
                amplienceSchema: 'http://bigcontent.io/cms/schema/v1/core#/definitions/localized-value',
                amplienceWidgetAttributes: JSON.stringify({
                    previewFields: [
                        { name: 'values', type: 'list', value: '1 item(s)' },
                        { name: 'values', type: 'object', value: '2 properties' }
                    ]
                }),
                amplienceSourceJson: JSON.stringify({
                    item: {
                        content: {
                            _meta: {
                                schema: 'http://bigcontent.io/cms/schema/v1/core#/definitions/localized-value'
                            },
                            values: [
                                { locale: 'en-US', value: 'Hello from Amplience' },
                                { locale: 'fr-FR', value: 'Bonjour' }
                            ]
                        }
                    }
                }),
                body: '<p></p>'
            }
        });

        expect(model.fields.some(function (field) {
            return field.type === 'text' && field.value === 'Hello from Amplience';
        })).to.equal(true);
    });
});
