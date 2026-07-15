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
});
