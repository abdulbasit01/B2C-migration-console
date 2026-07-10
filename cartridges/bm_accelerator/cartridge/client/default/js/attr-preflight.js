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

    /**
     * Platform-aware labels from migrationUi JSON (script tag or data attribute).
     * @returns {Object}
     */
    function readMigrationUi() {
        var el = document.getElementById('acc-migration-ui-data');
        if (el && el.textContent) {
            try {
                return JSON.parse(el.textContent);
            } catch (e1) { /* fall through */ }
        }
        var root = document.querySelector('[data-migration-ui]');
        if (root) {
            try {
                var raw = root.getAttribute('data-migration-ui');
                return raw ? JSON.parse(raw) : {};
            } catch (e2) { return {}; }
        }
        return {};
    }

    /**
     * @param {Object} ui
     * @param {number} count
     * @returns {string}
     */
    function missingCountLabel(ui, count) {
        return count + ((ui && ui.attrsMissingCount) || ' attribute(s) missing in SFCC:');
    }

    /**
     * @param {Object} ui
     * @param {number} count
     * @returns {string}
     */
    function missingBriefLabel(ui, count) {
        return count + ((ui && ui.attrsMissingBrief) || ' attribute(s) missing.');
    }

    global.AccAttrPreflight = {
        sfccTypeSelectHtml: sfccTypeSelectHtml,
        readSfccType:       readSfccType,
        readMigrationUi:    readMigrationUi,
        missingCountLabel:  missingCountLabel,
        missingBriefLabel:  missingBriefLabel
    };
}(typeof window !== 'undefined' ? window : this));
