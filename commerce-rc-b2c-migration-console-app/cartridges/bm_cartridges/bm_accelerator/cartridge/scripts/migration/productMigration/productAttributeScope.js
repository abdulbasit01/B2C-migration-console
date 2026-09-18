'use strict';

/**
 * Collect attribute names that are actually present on the published/current
 * master variant and additional variants of the requested CT products.
 * Staged values are intentionally ignored to match product migration.
 *
 * @param {Array<Object>} products CommerceTools Product resources
 * @returns {Object.<string, boolean>} attribute-name lookup
 */
function collectCurrentAttributeNames(products) {
    var names = {};
    var list = products || [];

    /**
     * @param {Array<Object>} attributes attribute values from one CT variant
     */
    function addAttributes(attributes) {
        var i;
        for (i = 0; i < (attributes || []).length; i++) {
            if (attributes[i] && attributes[i].name) {
                names[String(attributes[i].name)] = true;
            }
        }
    }

    for (var p = 0; p < list.length; p++) {
        var product = list[p] || {};
        var masterData = product.masterData || {};
        var current = masterData.current || {};
        var masterVariant = current.masterVariant || {};
        var variants = current.variants || [];

        addAttributes(masterVariant.attributes);
        for (var v = 0; v < variants.length; v++) {
            addAttributes(variants[v] && variants[v].attributes);
        }
    }

    return names;
}

/**
 * Limit the global CT Product Type field list to attributes present on the
 * requested products. Field order remains stable.
 *
 * @param {Array<Object>} fields Product Type attribute descriptors
 * @param {Array<Object>} products CommerceTools Product resources
 * @returns {Array<Object>} product-specific attribute descriptors
 */
function filterFieldsForProducts(fields, products) {
    var present = collectCurrentAttributeNames(products);
    var filtered = [];
    var list = fields || [];
    for (var i = 0; i < list.length; i++) {
        if (list[i] && present[list[i].name]) filtered.push(list[i]);
    }
    return filtered;
}

module.exports = {
    collectCurrentAttributeNames: collectCurrentAttributeNames,
    filterFieldsForProducts:      filterFieldsForProducts
};
