'use strict';

var assert = require('chai').assert;
var loader = require('../helpers/cartridgeLoader');

describe('nativeFieldMap', function () {
    var nativeFieldMap;

    before(function () {
        nativeFieldMap = loader.requireCartridge('config/nativeFieldMap');
    });

    it('normalizes skip/flag to map action', function () {
        var rule = nativeFieldMap.getRule('shopify', 'Customer', 'email');
        assert.isNotNull(rule);
        assert.equal(rule.action, 'map');
        assert.equal(rule.sfccField, 'email');
        assert.isTrue(nativeFieldMap.isMapAction(rule.action));
        assert.isTrue(nativeFieldMap.isSkipped('shopify', 'Customer', 'email'));
    });

    it('maps Shopify product title to name', function () {
        var rule = nativeFieldMap.getRule('shopify', 'Product', 'title');
        assert.isNotNull(rule);
        assert.equal(rule.action, 'map');
        assert.equal(rule.sfccField, 'name');
    });

    it('leaves unlisted source fields for on-the-fly custom create', function () {
        assert.isNull(nativeFieldMap.getRule('shopify', 'Product', 'Color'));
        assert.isNull(nativeFieldMap.getRule('ct', 'Product', 'color-code'));
        assert.isNull(nativeFieldMap.getRule('ct', 'Product', 'finish-code'));
    });

    it('normalizes commercetools / ctp platform ids to ct', function () {
        assert.equal(nativeFieldMap.normalizePlatformId('commercetools'), 'ct');
        assert.equal(nativeFieldMap.normalizePlatformId('ctp'), 'ct');
        assert.equal(nativeFieldMap.normalizePlatformId('CT'), 'ct');
        var viaLegacy = nativeFieldMap.getRule('commercetools', 'Product', 'description');
        var viaCt = nativeFieldMap.getRule('ct', 'Product', 'description');
        assert.isNotNull(viaLegacy);
        assert.isNotNull(viaCt);
        assert.equal(viaLegacy.sfccField, viaCt.sfccField);
        assert.equal(viaCt.sfccField, 'shortDescription');
    });

    it('getEffectiveRule uses detector against system attrs when no static rule', function () {
        var rule = nativeFieldMap.getEffectiveRule(
            'shopify',
            'Customer',
            'shopify_phone_mobile',
            'Phone Mobile',
            [{ id: 'phoneMobile', displayName: 'Phone Mobile', system: true }]
        );
        assert.isNotNull(rule);
        assert.equal(rule.action, 'map');
        assert.equal(rule.sfccField, 'phoneMobile');
    });

    it('getMappedSourceFields returns curated aliases only', function () {
        var fields = nativeFieldMap.getMappedSourceFields('ct', 'Product');
        assert.isArray(fields);
        assert.isTrue(fields.length > 0);
        var names = fields.map(function (f) { return f.name; });
        assert.include(names, 'name');
        assert.include(names, 'description');
        assert.include(names, 'sku');
        // brand is in sfccSystem but has no CT Product alias — not invented here
        assert.notInclude(names, 'brand');
        assert.notInclude(names, 'manufacturer');
        assert.notInclude(names, 'ean');
        var byName = {};
        fields.forEach(function (f) { byName[f.name] = f; });
        assert.equal(byName.description.sfccId, 'description');
        assert.equal(byName.description.sourceKey, 'description');
        assert.equal(byName.sku.sfccId, 'sku');
        assert.equal(nativeFieldMap.getRule('ct', 'Product', 'description').sfccField, 'shortDescription');
        assert.equal(nativeFieldMap.getRule('ct', 'Product', 'sku').sfccField, 'manufacturerSKU');
    });

    it('getSystemIds returns dump-backed Product system attrs', function () {
        var ids = nativeFieldMap.getSystemIds('Product');
        assert.isArray(ids);
        assert.isTrue(ids.length > 0);
        assert.include(ids, 'longDescription');
        assert.include(ids, 'name');
    });

    it('shares sfccSystem identity across platforms', function () {
        var ct = nativeFieldMap.getRule('ct', 'Customer', 'email');
        var shy = nativeFieldMap.getRule('shopify', 'Customer', 'email');
        assert.isNotNull(ct);
        assert.isNotNull(shy);
        assert.equal(ct.sfccField, 'email');
        assert.equal(shy.sfccField, 'email');
        assert.equal(ct.action, 'map');
        assert.equal(shy.action, 'map');
    });

    it('maps CT Store built-ins; leaves location/channel fields custom', function () {
        assert.equal(nativeFieldMap.getRule('ct', 'Store', 'id').sfccField, 'ID');
        assert.equal(nativeFieldMap.getRule('ct', 'Store', 'name').sfccField, 'name');
        assert.equal(nativeFieldMap.getRule('ct', 'Store', 'countries').sfccField, 'countryCode');
        assert.equal(nativeFieldMap.getRule('ct', 'Store', 'createdAt').sfccField, 'creationDate');
        assert.equal(nativeFieldMap.getRule('ct', 'Store', 'lastModifiedAt').sfccField, 'lastModified');
        // CT has countries[] (StoreCountry.code), not a singular country field
        assert.isNull(nativeFieldMap.getRule('ct', 'Store', 'country'));
        assert.isNull(nativeFieldMap.getRule('shopify', 'Store', 'zip'));
        // key is custom; UUID only maps from UUID
        assert.isNull(nativeFieldMap.getRule('ct', 'Store', 'key'));
        assert.isNull(nativeFieldMap.getRule('ct', 'Product', 'key'));
        assert.equal(nativeFieldMap.getRule('ct', 'Product', 'id').sfccField, 'ID');
        assert.isNull(nativeFieldMap.getRule('ct', 'Order', 'id'));
    });

    it('maps only CT API built-in fields (not Product Type attributes)', function () {
        // Product Type attrs are custom unless they identity-match an SFCC system id
        assert.isNull(nativeFieldMap.getRule('ct', 'Product', 'manufacturer'));
        assert.isNull(nativeFieldMap.getRule('ct', 'Customer', 'phone'));
        // Identity match still allowed (3.b): ean/UPC exist as SFCC system ids
        assert.equal(nativeFieldMap.getRule('ct', 'Product', 'ean').sfccField, 'EAN');
        assert.equal(nativeFieldMap.getRule('ct', 'Product', 'upc').sfccField, 'UPC');
        // CT API built-in renames
        assert.equal(nativeFieldMap.getRule('ct', 'Product', 'description').sfccField, 'shortDescription');
        assert.equal(nativeFieldMap.getRule('ct', 'Product', 'masterData.published').sfccField, 'onlineFlag');
        assert.equal(nativeFieldMap.getRule('ct', 'Customer', 'dateOfBirth').sfccField, 'birthday');
        assert.equal(nativeFieldMap.getRule('ct', 'Customer', 'isEmailVerified').sfccField, 'emailVerified');
        assert.equal(nativeFieldMap.getRule('ct', 'Order', 'orderNumber').sfccField, 'orderNo');
        assert.equal(nativeFieldMap.getRule('ct', 'Order', 'totalPrice.currencyCode').sfccField, 'currencyCode');
        // Not CT Order built-ins
        assert.isNull(nativeFieldMap.getRule('ct', 'Order', 'currency'));
        assert.isNull(nativeFieldMap.getRule('ct', 'Order', 'externalId'));
    });

    it('has no curated system list for objects without a dump', function () {
        // PriceBook dump exists; name is not a PriceBook system id
        assert.isNull(nativeFieldMap.getRule('shopify', 'PriceBook', 'name'));
        assert.equal(nativeFieldMap.getRule('ct', 'PriceBook', 'value.currencyCode').sfccField, 'currencyCode');
        assert.isNull(nativeFieldMap.getRule('bigcommerce', 'CustomerGroup', 'name'));
    });

    it('enforces one-to-one alias targets (no duplicate SFCC fields)', function () {
        var map = require('../../../../commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges/bm_accelerator/cartridge/scripts/migration/config/nativeFieldMap.json');
        var platforms = Object.keys(map.aliases || {});
        var pi;
        for (pi = 0; pi < platforms.length; pi++) {
            var platform = platforms[pi];
            var tasks = Object.keys(map.aliases[platform] || {});
            var ti;
            for (ti = 0; ti < tasks.length; ti++) {
                var task = tasks[ti];
                var aliases = map.aliases[platform][task] || {};
                var seen = {};
                var keys = Object.keys(aliases);
                var ki;
                for (ki = 0; ki < keys.length; ki++) {
                    var raw = aliases[keys[ki]];
                    var target = (raw && raw.sfccField) ? raw.sfccField : raw;
                    assert.isUndefined(
                        seen[target],
                        platform + '/' + task + ': duplicate target "' + target
                            + '" from "' + seen[target] + '" and "' + keys[ki] + '"'
                    );
                    seen[target] = keys[ki];
                }
            }
        }
        assert.include(platforms, 'ct');
        assert.notInclude(platforms, 'commercetools');
        assert.isNull(nativeFieldMap.getRule('ct', 'CustomerAddress', 'key'));
        assert.isNull(nativeFieldMap.getRule('ct', 'CustomerAddress', 'streetNumber'));
        assert.isNull(nativeFieldMap.getRule('ct', 'CustomerAddress', 'region'));
        assert.equal(nativeFieldMap.getRule('ct', 'CustomerAddress', 'id').sfccField, 'ID');
        assert.equal(nativeFieldMap.getRule('ct', 'CustomerAddress', 'streetName').sfccField, 'address1');
        assert.equal(nativeFieldMap.getRule('ct', 'CustomerAddress', 'state').sfccField, 'stateCode');
    });

    it('coverage lists mapped and pending SFCC system identifiers per source', function () {
        var cov = nativeFieldMap.getCoverage('ct', 'Customer');
        assert.isNotNull(cov);
        assert.isObject(cov.attributes);
        assert.equal(cov.attributes.email.status, 'mapped');
        assert.equal(cov.attributes.email.source, 'email');
        assert.equal(cov.attributes.birthday.status, 'mapped');
        assert.equal(cov.attributes.birthday.source, 'dateOfBirth');
        assert.equal(cov.attributes.fax.status, 'pending');
        assert.isNull(cov.attributes.fax.source);
        assert.equal(cov.attributes.phoneMobile.status, 'pending');
        assert.equal(cov.mappedCount + cov.pendingCount, cov.sfccSystemCount);

        var order = nativeFieldMap.getCoverage('commercetools', 'Order');
        assert.isNotNull(order);
        assert.equal(order.attributes.orderNo.status, 'mapped');
        assert.equal(order.attributes.orderNo.source, 'orderNumber');
        assert.equal(order.attributes.currencyCode.status, 'mapped');
        assert.equal(order.attributes.currencyCode.source, 'totalPrice.currencyCode');
    });

    it('getSkippedFields returns curated non-attribute source fields with notes', function () {
        var skipped = nativeFieldMap.getSkippedFields('ct', 'Order');
        assert.isArray(skipped);
        assert.isTrue(skipped.length > 0);
        var byId = {};
        skipped.forEach(function (s) { byId[s.id] = s; });
        assert.property(byId, 'taxMode');
        assert.equal(byId.taxMode.status, 'skipped');
        assert.isTrue(String(byId.taxMode.note).indexOf('tax') >= 0);
        assert.property(byId, 'lineItems');
        assert.isTrue(nativeFieldMap.isSkipped('commercetools', 'Order', 'taxMode'));
        assert.isTrue(nativeFieldMap.isSkipped('ct', 'Order', 'version'));
        assert.isTrue(nativeFieldMap.isExplicitSkip('ct', 'Product', 'key'));
        assert.isFalse(nativeFieldMap.isExplicitSkip('ct', 'Product', 'name'));
        // name is mapped via alias, not an explicit skip
        assert.isTrue(nativeFieldMap.isSkipped('ct', 'Product', 'name'));
    });
});
