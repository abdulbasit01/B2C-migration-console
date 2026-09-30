'use strict';

/* eslint-env mocha */

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var path = require('path');

var checkerPath = path.join(
    __dirname,
    '../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/productMigration/productAttrChecker.js'
);

/**
 * @param {string} name - attribute name
 * @param {string} type - CT type name
 * @param {string} constraint - CT attributeConstraint
 * @returns {Object} CT product type attribute definition
 */
function def(name, type, constraint) {
    return { name: name, label: { en: name }, type: { name: type }, attributeConstraint: constraint };
}

// Shapes taken from the mars-mms-test-us product types (2026-09-25 dump).
var PRODUCT_TYPES = [
    { name: 'Apparel',
        attributes: [
            def('apparelAdultSize', 'lenum', 'CombinationUnique'),
            def('apparelAgeGroup', 'lenum', 'CombinationUnique'),
            def('color', 'lenum', 'CombinationUnique'),
            def('secondaryDescription', 'ltext', 'SameForAll'),
            def('dimensions', 'ltext', 'None')
        ] },
    { name: 'Personalizable',
        attributes: [
            def('bagSizeLb', 'lenum', 'CombinationUnique'),
            def('customizationType', 'lenum', 'None'),
            def('externalTaxCode', 'lenum', 'SameForAll'),
            def('colorOrPattern', 'text', 'CombinationUnique')
        ] },
    { name: 'Other',
        attributes: [
            def('externalTaxCode', 'lenum', 'SameForAll'),
            def('flavor', 'lenum', 'SameForAll')
        ] },
    // Same name in a later type with a variation constraint: one variation use is enough.
    { name: 'Candy', attributes: [def('flavor', 'lenum', 'CombinationUnique')] }
];

/**
 * @param {Object} httpStub - replacement for core/http
 * @param {Array} captured - receives the attrs passed to createDefinitions
 * @param {Array} missing - create candidates returned by classifyFields
 * @returns {Object} productAttrChecker with dependencies stubbed
 */
function loadWith(httpStub, captured, missing) {
    return proxyquire(checkerPath, {
        '*/cartridge/scripts/migration/core/http': httpStub,
        '*/cartridge/scripts/migration/configAccessor': {
            ctp: { authUrl: 'a', apiUrl: 'b', projectKey: 'p', clientId: 'c', clientSecret: 's' }
        },
        'dw/crypto/Encoding': { toBase64: function () { return 'x'; } },
        'dw/util/Bytes': function () {},
        '*/cartridge/scripts/migration/core/attrBuilder': {
            toLabel: function (l) { return l && l.en; }
        },
        '*/cartridge/scripts/migration/config/nativeFieldMap': {
            getMappedSourceFields: function () { return []; }
        },
        '*/cartridge/scripts/migration/core/attrPreflightRunner': {
            classifyFields: function () {
                return { mapped: [], missing: JSON.parse(JSON.stringify(missing || [])) };
            },
            createDefinitions: function (type, groupId, groupName, attrs) {
                captured.push(attrs);
                return { ok: true };
            }
        }
    });
}

var CT_OK = {
    post: function () { return { status: 200, data: { access_token: 't' } }; },
    get: function () { return { status: 200, data: { results: PRODUCT_TYPES } }; }
};

var CT_DOWN = {
    post: function () { return { status: 500, data: {} }; },
    get: function () { return { status: 500, data: {} }; }
};

/**
 * @param {string} id - attribute id
 * @returns {Object} a create candidate as enrichMissingAttribute returns it for a CT lenum or ltext
 */
function localizedCandidate(id) {
    return { id: id, localizable: true, sourceLocalizable: true, scope: 'localized' };
}

describe('productAttrChecker variation attribute scope', function () {
    it('flags localized enums that can be variation attributes, and nothing else', function () {
        var ids = loadWith(CT_OK, []).getCtpProductTypeFields().variationIds;
        assert.deepEqual(Object.keys(ids).sort(), [
            'apparelAdultSize', 'apparelAgeGroup', 'bagSizeLb', 'color', 'customizationType', 'flavor'
        ]);
    });

    it('shows variation candidates as non-localized in the check table', function () {
        var checker = loadWith(CT_OK, [], [
            localizedCandidate('bagSizeLb'),
            localizedCandidate('customizationType'),
            localizedCandidate('secondaryDescription'),
            localizedCandidate('externalTaxCode')
        ]);
        var byId = {};
        checker.checkMissingAttributes().missing.forEach(function (m) { byId[m.id] = m; });

        assert.isFalse(byId.bagSizeLb.localizable);
        assert.equal(byId.bagSizeLb.scope, 'none');
        assert.isTrue(byId.bagSizeLb.sourceLocalizable, 'page still explains the source was localized');
        assert.isFalse(byId.customizationType.localizable, 'None-constraint lenum can be a variation attribute');
        assert.isTrue(byId.secondaryDescription.localizable, 'ltext stays localized');
        assert.isTrue(byId.externalTaxCode.localizable, 'SameForAll lenum stays localized');
    });

    it('creates variation candidates non-localizable even when the page sends localizable=true', function () {
        var captured = [];
        loadWith(CT_OK, captured).createAttributes([
            { id: 'flavor', localizable: true },
            { id: 'bagSizeLbRenamed', canonicalId: 'bagSizeLb', localizable: true },
            { id: 'secondaryDescription', localizable: true }
        ]);
        assert.isFalse(captured[0][0].localizable);
        assert.isFalse(captured[0][1].localizable, 'renamed on the create screen, matched by canonicalId');
        assert.isTrue(captured[0][2].localizable);
    });

    it('leaves requests untouched when commercetools is unreachable', function () {
        var captured = [];
        loadWith(CT_DOWN, captured).createAttributes([{ id: 'flavor', localizable: true }]);
        assert.isTrue(captured[0][0].localizable);
    });
});
