'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var path = require('path');

var clientPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/client/default/js/attr-preflight.js'
);

describe('attribute pre-flight client mapping targets', function () {
    var preflight;

    before(function () {
        preflight = require(clientPath).AccAttrPreflight;
    });

    it('renders existing custom attributes with type and localization metadata', function () {
        var html = preflight.customFieldOptionsHtml([
            {
                id: 'product_name',
                valueType: 'string',
                localizable: true,
                normalizedMatch: true
            }
        ], 'product_name');

        assert.include(html, 'value="product_name"');
        assert.include(html, 'data-target-kind="custom"');
        assert.include(html, 'product_name (string) [localized]');
        assert.include(html, 'normalized-name match');
        assert.include(html, ' selected');
    });
});
