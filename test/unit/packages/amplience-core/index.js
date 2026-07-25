'use strict';

/* global describe, it */

var expect = require('chai').expect;
var core = require('../../../../packages/amplience-core/src/index');

describe('amplience-core package', function () {
    it('builds CDN URLs with encoded path segments', function () {
        var url = core.buildCdnUrl('demo', 'page/jackets');
        expect(url).to.equal(
            'https://demo.cdn.content.amplience.net/content/key/page/jackets?depth=all&format=inlined'
        );
    });

    it('detects mainBanner for hero schemas with image', function () {
        var content = {
            _meta: { schema: 'https://example.com/schemas/hero-banner' },
            title: 'Summer Sale',
            img: {
                image: {
                    defaultHost: 'cdn.media.amplience.net',
                    endpoint: 'i',
                    name: 'hero-image'
                }
            }
        };
        expect(core.detectWidgetType(content)).to.equal('mainBanner');
    });

    it('builds a renderer model with cache-busted image URL', function () {
        var content = {
            _meta: { schema: 'https://example.com/schemas/hero-banner' },
            title: 'Hero',
            img: {
                image: {
                    id: 'img-123',
                    defaultHost: 'cdn.media.amplience.net',
                    endpoint: 'i',
                    name: 'hero-image'
                }
            },
            textAlign: 'center'
        };

        var model = core.toRendererModel(content, {
            hubName: 'demo',
            deliveryKey: 'hero'
        });

        expect(model.widgetType).to.equal('mainBanner');
        expect(model.deliveryKey).to.equal('hero');
        expect(model.textAlign).to.equal('center');
        expect(model.imageUrl).to.contain('v=img-123');
        expect(model.heading).to.contain('Hero');
    });

    it('unwraps localized-value content into renderer fields', function () {
        var content = {
            _meta: {
                schema: 'http://bigcontent.io/cms/schema/v1/core#/definitions/localized-value'
            },
            values: [
                { locale: 'en-US', value: 'Sunglasses' },
                { locale: 'fr-FR', value: 'Des lunettes de soleil' }
            ]
        };

        var parts = core.extractPreviewParts(content);
        expect(parts.title).to.equal('Sunglasses');
    });

    it('maps SFCC rich-text wrapper markdown into editorialRichText', function () {
        var content = {
            _meta: {
                schema: 'https://sfcc.com/components/rich-text',
                name: 'Content - Amplience Wrapper by key'
            },
            header: {
                values: [{ locale: 'en-US', value: 'RichText Content' }]
            },
            content: {
                values: [{
                    locale: 'en-US',
                    value: {
                        richText: [{
                            type: 'markdown',
                            data: '**Royal Cyber**\n\n# Discover style\n\nShop now.'
                        }]
                    }
                }]
            }
        };

        var model = core.toRendererModel(content, {
            hubName: 'royalcyber',
            contentId: '4d2bf3b9-91ea-4d06-84a5-d3c826bbac0a'
        });

        expect(model.widgetType).to.equal('editorialRichText');
        expect(model.name).to.equal('RichText Content');
        expect(model.bodyHtml).to.contain('<strong>Royal Cyber</strong>');
        expect(model.bodyHtml).to.contain('<h1>Discover style</h1>');
    });

    it('groups locale-suffixed preview fields into dropdown rows', function () {
        var fields = [
            { name: 'seo.title.values[en-us]', type: 'text', value: 'Personalisation' },
            { name: 'seo.title.values[fr-fr]', type: 'text', value: 'Personnalisation' },
            { name: 'seo.title.values[de-de]', type: 'text', value: 'Personalisierung' },
            { name: 'seo.noindex', type: 'text', value: 'false' }
        ];

        var grouped = core.groupLocalizedPreviewFields(fields);
        expect(grouped).to.have.lengthOf(2);
        expect(grouped[0].type).to.equal('localized');
        expect(grouped[0].name).to.equal('seo.title.values');
        expect(grouped[0].options).to.have.lengthOf(3);
        expect(grouped[1].name).to.equal('seo.noindex');
    });

    it('fetchLiveContent uses fetchImpl and maps CDN payload', function () {
        var payload = {
            content: {
                content: {
                    _meta: { schema: 'https://example.com/schemas/campaign-banner' },
                    bannerMessage: 'Free shipping'
                }
            }
        };

        function fetchImpl() {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: function () {
                    return Promise.resolve(payload);
                }
            });
        }

        return core.fetchLiveContent('demo', 'promo/header', { fetchImpl: fetchImpl })
            .then(function (model) {
                expect(model.widgetType).to.equal('campaignBanner');
                expect(model.liveHubName).to.equal('demo');
            });
    });
});
