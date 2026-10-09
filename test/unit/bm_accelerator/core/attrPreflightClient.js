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

    var rows = [
        { id: 'stores', sfccField: 'stores', status: 'type-mismatch', sfccType: 'string', expectedType: 'set_of_string', note: 'Delete <it>' },
        { id: 'isB2BProduct', sfccField: 'isB2BProduct', status: 'exists', note: 'Already exists in SFCC.' },
        { id: 'name', sfccField: 'name', status: 'mapped' }
    ];

    it('shows wrong-type attributes as plain "already exists" rows while the type check is off', function () {
        var split = preflight.splitMapped(rows, false);
        assert.lengthOf(split.typeMismatch, 0);
        assert.lengthOf(split.alreadyExists, 2);
        assert.equal(split.alreadyExists[0].status, 'exists');
        assert.equal(split.alreadyExists[0].note, 'Already exists in SFCC.');
        assert.lengthOf(split.systemMapped, 1);
    });

    it('lists wrong-type attributes with both types and a delete button while the type check is on', function () {
        var split = preflight.splitMapped(rows, true);
        assert.lengthOf(split.typeMismatch, 1);
        assert.lengthOf(split.alreadyExists, 1);

        var html = preflight.typeMismatchTableHtml(split.typeMismatch, true);
        assert.include(html, '1 existing SFCC attribute(s) with the wrong type');
        assert.include(html, '<code>stores</code>');
        assert.include(html, '>string<');
        assert.include(html, '>set_of_string<');
        assert.include(html, 'Delete &lt;it&gt;');
        assert.include(html, 'class="cm-btn cm-btn--secondary acc-type-del-btn" data-attr-id="stores"');
        assert.notInclude(preflight.typeMismatchTableHtml(split.typeMismatch, false), 'acc-type-del-btn');
        assert.equal(preflight.typeMismatchTableHtml([], true), '');
    });

    it('keeps the type check as a collapsed "Advanced" line at the bottom, off by default', function () {
        var off = preflight.typeCheckSectionHtml([rows[0]], false, true, false);
        assert.include(off, '<details id="acc-type-check"');
        assert.notInclude(off, '<details id="acc-type-check" style="margin:24px 0 0;" open');
        assert.include(off, '>Advanced</summary>');
        assert.notInclude(off, ' checked');
        assert.notInclude(off, 'acc-type-del-btn');

        var on = preflight.typeCheckSectionHtml([rows[0]], true, true, true);
        assert.include(on, ' open>');
        assert.include(on, ' checked');
        assert.include(on, 'acc-type-del-btn');
    });
});
