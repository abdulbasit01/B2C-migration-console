'use strict';

var SUPPORTED_VALUE_TYPES = {
    string: true,
    int: true,
    integer: true,
    enum_of_string: true,
    enum_of_int: true,
    'enum-of-string': true,
    'enum-of-int': true
};

/**
 * Normalize an OCAPI value type for comparison.
 * @param {string} valueType - Value type from an attribute definition.
 * @returns {string} normalized value type
 */
function normalizedValueType(valueType) {
    return String(valueType || '').trim().toLowerCase();
}

/**
 * Describe why an existing SFCC Product attribute cannot be a variation axis.
 * Empty valueType is treated as unknown because some OCAPI list responses omit it.
 * @param {Object} definition - SFCC Product attribute definition.
 * @returns {Array<string>} incompatibility reasons
 */
function incompatibilityReasons(definition) {
    var reasons = [];
    if (!definition) return reasons;
    if (definition.localizable === true) reasons.push('it is localizable');
    if (definition.siteSpecific === true) reasons.push('it is site-specific');

    var valueType = normalizedValueType(definition.valueType);
    if (valueType && !SUPPORTED_VALUE_TYPES[valueType]) {
        reasons.push('value type "' + definition.valueType + '" is not String or Integer');
    }
    return reasons;
}

/**
 * Validate resolved source-to-SFCC variation targets against live definitions.
 * @param {Array<Object>} targets - Resolved targets with name, id, and optional validateCompatibility.
 * @param {Array<Object>} definitions - Live SFCC Product definitions.
 * @returns {{notInSfcc: Array<string>, incompatible: Array<Object>}} validation result
 */
function validateTargets(targets, definitions) {
    var byId = {};
    var i;
    for (i = 0; i < (definitions || []).length; i++) {
        if (definitions[i] && definitions[i].id) {
            byId[definitions[i].id] = definitions[i];
        }
    }

    var notInSfcc = [];
    var incompatible = [];
    var seen = {};
    for (i = 0; i < (targets || []).length; i++) {
        var target = targets[i] || {};
        var sourceName = String(target.name || target.id || '');
        var targetId = String(target.id || '');
        var identity = sourceName + '\n' + targetId;
        if (targetId && !seen[identity]) {
            seen[identity] = true;

            var definition = byId[targetId];
            if (!definition) {
                notInSfcc.push(sourceName);
            } else {
                var reasons = target.validateCompatibility === false
                    ? []
                    : incompatibilityReasons(definition);
                if (reasons.length) {
                    incompatible.push({
                        name: sourceName,
                        id: targetId,
                        reasons: reasons,
                        message: reasons.join('; ')
                    });
                }
            }
        }
    }

    return { notInSfcc: notInSfcc, incompatible: incompatible };
}

module.exports = {
    incompatibilityReasons: incompatibilityReasons,
    validateTargets:        validateTargets
};
