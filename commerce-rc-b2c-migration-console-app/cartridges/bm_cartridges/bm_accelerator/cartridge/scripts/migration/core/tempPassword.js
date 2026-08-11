'use strict';

/**
 * Generate a non-deterministic temporary password for migrated customers.
 * Callers must not derive passwords from source IDs.
 */

var UUIDUtils = require('dw/util/UUIDUtils');

/**
 * @returns {string} random temporary password meeting typical SFCC complexity
 */
function generate() {
    var uuid = UUIDUtils.createUUID().replace(/-/g, '');
    // Prefix ensures letter + digit + symbol complexity without a fixed guessable formula
    return 'Tmp!' + uuid.substring(0, 16);
}

module.exports = {
    generate: generate
};
