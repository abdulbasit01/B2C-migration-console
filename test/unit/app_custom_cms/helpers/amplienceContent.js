'use strict';

/* global describe, it, beforeEach */

var expect = require('chai').expect;
var loader = require('./storefrontLoader');
var ContentMgr = require('../mocks/dw/content/ContentMgr');

loader.installCartridgeResolver();

var amplienceContent = loader.requireHelper('amplienceContent');

describe('amplienceContent storefront helper', function () {
    var Site = require('../mocks/dw/system/Site');

    beforeEach(function () {
        ContentMgr.__reset();
        Site.__reset();
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

    it('groups locale preview fields into a localized dropdown field', function () {
        var asset = {
            ID: 'amp-seo-page',
            name: 'SEO Page',
            online: true,
            custom: {
                amplienceWidgetType: 'amplienceWidget',
                amplienceSourceJson: JSON.stringify({
                    seo: {
                        title: {
                            values: [
                                { locale: 'en-US', value: 'Personalisation' },
                                { locale: 'fr-FR', value: 'Personnalisation' }
                            ]
                        },
                        noindex: false
                    }
                }),
                amplienceWidgetAttributes: '{}',
                body: '<p></p>'
            }
        };

        var model = amplienceContent.resolveFromContentAsset(asset);
        var localized = model.fields.filter(function (field) {
            return field.type === 'localized';
        });

        expect(localized.length).to.be.at.least(1);
        expect(localized[0].options.length).to.equal(2);
        expect(localized[0].markup).to.contain('amp-locale-select');
    });

    it('prefers amplienceSourceJson over shallow previewFields for locale dropdowns', function () {
        var asset = {
            ID: 'amp-seo-page-2',
            name: 'SEO Page',
            online: true,
            custom: {
                amplienceWidgetType: 'amplienceWidget',
                amplienceSourceJson: JSON.stringify({
                    seo: {
                        title: {
                            values: [
                                { locale: 'en-US', value: 'FAQ' },
                                { locale: 'fr-FR', value: 'FAQ FR' },
                                { locale: 'de-DE', value: 'FAQ DE' }
                            ]
                        }
                    }
                }),
                amplienceWidgetAttributes: JSON.stringify({
                    previewFields: [
                        { name: 'seo', type: 'object', value: '2 properties' }
                    ]
                }),
                body: '<p></p>'
            }
        };

        var model = amplienceContent.resolveFromContentAsset(asset);
        var localized = model.fields.filter(function (field) {
            return field.type === 'localized';
        });

        expect(localized.length).to.equal(1);
        expect(localized[0].options.length).to.equal(3);
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

    it('filters assets by search query across name and ids', function () {
        var assets = [
            {
                ID: 'amp-hero-banner',
                name: 'Women Fashion Hero',
                online: true,
                custom: {
                    amplienceWidgetType: 'mainBanner',
                    amplienceContentId: 'ba65f899-6545-4a21-8f09-00387d3a4b7d',
                    amplienceWidgetAttributes: '{}'
                }
            },
            {
                ID: 'amp-editorial-1',
                name: 'About Us Copy',
                online: true,
                custom: {
                    amplienceWidgetType: 'editorialRichText',
                    amplienceContentId: '11111111-1111-1111-1111-111111111111',
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

        var byType = amplienceContent.getAmplienceAssets({
            type: 'editorialRichText'
        });
        var byQuery = amplienceContent.getAmplienceAssets({
            query: 'ba65f899'
        });

        expect(byType.total).to.equal(1);
        expect(byType.items[0].id).to.equal('amp-editorial-1');
        expect(byQuery.total).to.equal(1);
        expect(byQuery.items[0].id).to.equal('amp-hero-banner');
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

    it('does not add locale dropdown metadata to banner gallery cards', function () {
        var asset = {
            ID: 'amp-hero',
            name: 'Hero',
            online: true,
            custom: {
                amplienceWidgetType: 'mainBanner',
                amplienceImageUrl: 'https://cdn.example.com/hero.png',
                amplienceWidgetAttributes: JSON.stringify({
                    heading: '<h1>Hero</h1>'
                }),
                body: '<p></p>'
            }
        };

        var model = amplienceContent.resolveFromContentAsset(asset);
        var galleryModel = amplienceContent.enrichGalleryModel(model, asset);

        expect(galleryModel.availableLocales).to.have.lengthOf(0);
        expect(galleryModel.fields).to.have.lengthOf(0);
    });

    it('uses a card-level locale on gallery models without per-field dropdowns', function () {
        var asset = {
            ID: 'amp-seo-gallery',
            name: 'SEO Gallery',
            online: true,
            custom: {
                amplienceWidgetType: 'amplienceWidget',
                amplienceSourceJson: JSON.stringify({
                    seo: {
                        title: {
                            values: [
                                { locale: 'en-US', value: 'Personalisation' },
                                { locale: 'fr-FR', value: 'Personnalisation' }
                            ]
                        }
                    }
                }),
                amplienceWidgetAttributes: '{}',
                body: '<p></p>'
            }
        };

        var model = amplienceContent.resolveFromContentAsset(asset);
        var galleryModel = amplienceContent.enrichGalleryModel(model, asset);

        expect(galleryModel.availableLocales).to.have.lengthOf(2);
        expect(galleryModel.previewLocale).to.equal('en-US');
        expect(galleryModel.fields[0].markup).to.not.contain('amp-locale-select');
        expect(galleryModel.fields[0].markup).to.contain('Personalisation');
    });

    it('returns locale-specific gallery preview html from migrated source', function () {
        ContentMgr.__setContent('amp-seo-gallery', {
            ID: 'amp-seo-gallery',
            name: 'SEO Gallery',
            online: true,
            custom: {
                amplienceWidgetType: 'amplienceWidget',
                amplienceSourceJson: JSON.stringify({
                    seo: {
                        title: {
                            values: [
                                { locale: 'en-US', value: 'Personalisation' },
                                { locale: 'fr-FR', value: 'Personnalisation' }
                            ]
                        }
                    }
                }),
                amplienceWidgetAttributes: '{}',
                body: '<p></p>'
            }
        });

        var preview = amplienceContent.getGalleryPreviewForLocale('amp-seo-gallery', 'fr-FR');

        expect(preview.ok).to.equal(true);
        expect(preview.html).to.contain('Personnalisation');
        expect(preview.locale).to.equal('fr-FR');
    });
});
