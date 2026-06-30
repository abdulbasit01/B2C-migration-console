/**
 * Shared helpers for attribute pre-flight tables (customer, product, shipping migrations).
 */
(function (global) {
    'use strict';

    function escHtml(val) {
        if (val === null || val === undefined) return '';
        return String(val)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Render a <select> for SFCC value_type choices.
     * @param {Object} m - missing attr { sfccType, sfccTypeOptions }
     * @param {number|string} idx - row index
     * @param {string} [selectClass]
     * @returns {string} HTML
     */
    function sfccTypeSelectHtml(m, idx, selectClass) {
        var opts = m.sfccTypeOptions;
        if (!opts || !opts.length) {
            opts = [{ value: m.sfccType || 'string', label: m.sfccType || 'string' }];
        }
        var cls = selectClass || 'cm-attr-type-select';
        var html = '<select class="' + cls + '" data-idx="' + idx + '">';
        for (var o = 0; o < opts.length; o++) {
            var selected = (opts[o].value === (m.sfccType || opts[0].value)) ? ' selected' : '';
            html += '<option value="' + escHtml(opts[o].value) + '"' + selected + '>'
                + escHtml(opts[o].label || opts[o].value) + '</option>';
        }
        return html + '</select>';
    }

    /**
     * Read the user's SFCC type choice for a table row.
     * @param {number|string} idx
     * @param {string} fallback
     * @param {string} [selectClass]
     * @returns {string}
     */
    function readSfccType(idx, fallback, selectClass) {
        var cls = selectClass || 'cm-attr-type-select';
        var sel = document.querySelector('.' + cls + '[data-idx="' + idx + '"]');
        return sel ? sel.value : fallback;
    }

    global.AccAttrPreflight = {
        sfccTypeSelectHtml: sfccTypeSelectHtml,
        readSfccType:       readSfccType
    };
}(typeof window !== 'undefined' ? window : this));
