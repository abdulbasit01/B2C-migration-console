'use strict';

/* global describe, it */

var expect = require('chai').expect;
var loader = require('./storefrontLoader');

loader.installCartridgeResolver();

var amplienceCdn = loader.requireHelper('amplienceCdn');
var amplienceLiveTransform = loader.requireHelper('amplienceLiveTransform');

describe('amplience live storefront helpers', function () {
    it('builds CDN URLs with encoded path segments', function () {
        var url = amplienceCdn.buildCdnUrl('demo', 'page/jackets');
        expect(url).to.equal(
            'https://demo.cdn.content.amplience.net/content/key/page/jackets?depth=all&format=inlined'
        );
    });

    it('merges live localized content into a migrated model', function () {
        var baseModel = {
            id: 'amp-sunglasses',
            name: 'Old name',
            widgetType: 'amplienceWidget',
            schema: 'http://bigcontent.io/cms/schema/v1/core#/definitions/localized-value',
            deliveryKey: 'header/sunglasses',
            contentId: '0d90150b-55bf-4cb0-a0a9-65b8a252a26e',
            imageUrl: '',
            heading: '',
            bodyHtml: '<p></p>',
            hasBody: false,
            attributes: {},
            fields: [],
            images: [],
            source: {}
        };
        var liveContent = {
            _meta: {
                schema: 'http://bigcontent.io/cms/schema/v1/core#/definitions/localized-value'
            },
            values: [
                { locale: 'en-US', value: 'Sunglasses' },
                { locale: 'fr-FR', value: 'Des lunettes de soleil' }
            ]
        };

        function extractSourceFields(source) {
            return source.item.content.values.map(function (entry) {
                return {
                    name: 'values[' + entry.locale + ']',
                    type: 'text',
                    value: entry.value
                };
            });
        }

        function isMeaningfulMarkup(value) {
            return String(value || '').replace(/\s/g, '').length > 0;
        }

        var merged = amplienceLiveTransform.applyLiveContent(
            baseModel,
            liveContent,
            'demo',
            extractSourceFields,
            isMeaningfulMarkup
        );

        expect(merged.live).to.equal(true);
        expect(merged.liveHubName).to.equal('demo');
        expect(merged.name).to.equal('Sunglasses');
        expect(merged.fields[0].value).to.equal('Sunglasses');
    });
});
