'use strict';

/* global describe, it */

var expect = require('chai').expect;
var loader = require('../helpers/cartridgeLoader');

loader.installCartridgeResolver();

var xmlBuilder = loader.requireCartridge('contentMigration/contentXmlBuilder');
var metaBuilder = loader.requireCartridge('contentMigration/contentMetaXmlBuilder');

describe('Amplience content library XML', function () {
    var widget = {
        deliveryKey: 'mens/fashion',
        contentId: 'e63964f7-2d2b-4c2f-8679-f1e77e958255',
        widgetType: 'mainBanner',
        schema: 'https://example.com/schema/hero',
        schemaShort: 'hero',
        attributes: {
            heading: 'New Season',
            image: 'https://cdn.example.com/hero.png'
        },
        preview: {
            title: 'New Season',
            body: 'Shop now',
            image: 'https://cdn.example.com/hero.png'
        },
        sourceMetadata: {
            status: 'ACTIVE',
            locale: 'en-US'
        },
        source: {
            id: 'e63964f7-2d2b-4c2f-8679-f1e77e958255',
            body: {
                _meta: { schema: 'https://example.com/schema/hero' },
                linkedContent: { id: 'reference-1' },
                caption: 'Safe ]]> source'
            }
        }
    };

    it('builds importable library ordering with folder assignment', function () {
        var result = xmlBuilder.buildXml([widget], 'MigrationConsole');
        var customIndex = result.xml.indexOf('<custom-attributes>');
        var folderIndex = result.xml.indexOf('<folder-links>');

        expect(result.libraryId).to.equal('MigrationConsole');
        expect(result.built).to.equal(1);
        expect(customIndex).to.be.above(-1);
        expect(folderIndex).to.be.above(customIndex);
        expect(result.xml).to.contain('<classification-link folder-id="amplience"/>');
        expect(result.xml).to.contain('attribute-id="amplienceSourceJson"');
        expect(result.xml).to.contain('linkedContent');
        expect(result.xml).to.contain(']]]]><![CDATA[>');
    });

    it('defines source JSON metadata for Content assets', function () {
        var xml = metaBuilder.buildMetaXml();

        expect(xml).to.contain('<type-extension type-id="Content">');
        expect(xml).to.contain('attribute-id="amplienceSourceJson"');
        expect(xml).to.contain('<attribute-group group-id="Amplience">');
    });
});
