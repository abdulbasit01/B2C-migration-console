'use strict';

/**
 * Normalize a string for SFCC product-id (same rules as CT product migration).
 * @param {string} str
 * @returns {string}
 */
function sanitizeId(str) {
    if (!str) return '';
    return String(str)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 100);
}

/**
 * SFCC product-id from Shopify — always the Shopify variant ID (numeric string).
 * @param {{ variantId?: string|number }} opts
 * @returns {string}
 */
function toProductId(opts) {
    if (opts && opts.variantId) return String(opts.variantId);
    return '';
}

module.exports = {
    sanitizeId:  sanitizeId,
    toProductId: toProductId
};
