'use strict';

var assert = require('chai').assert;
var loader = require('../helpers/cartridgeLoader');

describe('sfccTypeCompat', function () {
    var compat;

    before(function () {
        compat = loader.requireCartridge('core/sfccTypeCompat');
    });

    it('allows a string/text source to map to string and html, not boolean or double', function () {
        var field = {
            sfccType: 'string',
            sfccTypeOptions: [
                { value: 'string' },
                { value: 'text' },
                { value: 'html' },
                { value: 'email' }
            ]
        };
        assert.isTrue(compat.isCompatible(field, 'string'));
        assert.isTrue(compat.isCompatible(field, 'html'));
        assert.isTrue(compat.isCompatible(field, 'email'));
        assert.isFalse(compat.isCompatible(field, 'boolean'));
        assert.isFalse(compat.isCompatible(field, 'double'));
        assert.isFalse(compat.isCompatible(field, 'datetime'));
        assert.isFalse(compat.isCompatible(field, 'image'));
    });

    it('allows a boolean source only to boolean', function () {
        var field = { sfccType: 'boolean', sfccTypeOptions: [{ value: 'boolean' }] };
        assert.isTrue(compat.isCompatible(field, 'boolean'));
        assert.isFalse(compat.isCompatible(field, 'string'));
        assert.isFalse(compat.isCompatible(field, 'int'));
    });

    it('allows number sources to int and double', function () {
        var field = { sfccType: 'double', sfccTypeOptions: [{ value: 'double' }, { value: 'int' }] };
        assert.isTrue(compat.isCompatible(field, 'double'));
        assert.isTrue(compat.isCompatible(field, 'int'));
        assert.isFalse(compat.isCompatible(field, 'string'));
    });

    it('rejects mapping when the system field has no value type', function () {
        var field = { sfccType: 'string' };
        assert.isFalse(compat.isCompatible(field, ''));
        assert.isFalse(compat.isCompatible(field, null));
    });

    it('filters coverage-pending fields by type', function () {
        var field = { sfccType: 'string' };
        var pending = [
            { id: 'EAN', valueType: 'string' },
            { id: 'searchable', valueType: 'boolean' },
            { id: 'minOrderQuantity', valueType: 'double' },
            { id: 'longDescription', valueType: 'html' }
        ];
        var ids = compat.filterPendingByType(field, pending).map(function (p) { return p.id; });
        assert.deepEqual(ids, ['EAN', 'longDescription']);
    });

    it('attachMappableSystemFields writes compatible ids; skips filter when untyped', function () {
        var missing = [{ id: 'key', sfccType: 'string' }];
        var pending = [
            { id: 'EAN', valueType: 'string' },
            { id: 'searchable', valueType: 'boolean' }
        ];
        compat.attachMappableSystemFields(missing, pending, true);
        assert.deepEqual(missing[0].mappableSystemFields, ['EAN']);

        var untypedMissing = [{ id: 'key', sfccType: 'string' }];
        var untypedPending = [{ id: 'EAN' }, { id: 'searchable' }];
        compat.attachMappableSystemFields(untypedMissing, untypedPending, false);
        assert.deepEqual(untypedMissing[0].mappableSystemFields, ['EAN', 'searchable']);
    });
});
