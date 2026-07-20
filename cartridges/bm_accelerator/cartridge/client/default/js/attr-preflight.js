/**
 * Shared helpers for attribute pre-flight across all migration modules.
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

    function readSfccType(idx, fallback, selectClass) {
        var cls = selectClass || 'cm-attr-type-select';
        var sel = document.querySelector('.' + cls + '[data-idx="' + idx + '"]');
        return sel ? sel.value : fallback;
    }

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

    function missingCountLabel(ui, count) {
        return count + ((ui && ui.attrsMissingCount) || ' attribute(s) missing in SFCC:');
    }

    function missingBriefLabel(ui, count) {
        return count + ((ui && ui.attrsMissingBrief) || ' attribute(s) missing.');
    }

    /**
     * Build missing-attrs table HTML with rename + status columns.
     * @param {Array} missing
     * @param {Object} ui
     * @returns {string}
     */
    function missingTableHtml(missing, ui) {
        var html = '<p style="font-size:13px;color:#54698d;margin:0 0 10px;">'
            + missingCountLabel(ui, missing.length) + '</p>';
        html += '<div style="border:1px solid #e0e5ee;border-radius:4px;overflow:hidden;"><table class="cm-attr-table"><thead><tr>'
            + '<th style="width:36px;"><input type="checkbox" id="acc-attr-select-all" checked/></th>'
            + '<th>Attribute ID</th><th>Label</th><th>' + ((ui && ui.sourceTypeCol) || 'Source Type') + '</th>'
            + '<th>SFCC Type</th><th style="width:120px;">Status</th></tr></thead><tbody>';
        var i;
        for (i = 0; i < missing.length; i++) {
            var m = missing[i];
            html += '<tr class="cm-attr-row" data-idx="' + i + '">'
                + '<td style="text-align:center;"><input type="checkbox" class="acc-attr-cb" data-idx="' + i + '" checked/></td>'
                + '<td><input type="text" class="cm-attr-id-input" data-idx="' + i + '" data-canonical="'
                + escHtml(m.id) + '" value="' + escHtml(m.id) + '"/>'
                + '<div class="cm-attr-map-hint" data-idx="' + i + '" style="display:none;margin-top:4px;font-size:11px;color:#54698d;line-height:1.35;"></div></td>'
                + '<td>' + escHtml(m.label || m.id) + '</td>'
                + '<td style="color:#8a9ab8;">' + escHtml(m.ctpType || m.sourceType || '') + '</td>'
                + '<td>' + sfccTypeSelectHtml(m, i) + '</td>'
                + '<td><span class="cm-attr-status" data-idx="' + i + '" style="font-size:12px;color:#8a9ab8;">&mdash;</span></td></tr>';
        }
        html += '</tbody></table></div>';
        html += '<div style="margin-top:14px;"><button type="button" id="acc-create-attrs-btn" class="cm-btn cm-btn--primary">Create Selected Attributes</button>'
            + '<span id="acc-create-attrs-msg" style="font-size:13px;color:#54698d;margin-left:12px;"></span></div>';
        return html;
    }

    function setRowAttrFeedback(idx, status, canonicalId, targetId, message) {
        var statusEl = document.querySelector('.cm-attr-status[data-idx="' + idx + '"]');
        var hintEl = document.querySelector('.cm-attr-map-hint[data-idx="' + idx + '"]');
        var colors = { created: '#2e7d32', exists: '#1565c0', error: '#c62828' };
        var labels = { created: 'Created', exists: 'Already exists', error: 'Error' };
        if (statusEl) {
            statusEl.textContent = labels[status] || message || status;
            statusEl.style.color = colors[status] || '#54698d';
            statusEl.title = message || '';
        }
        if (hintEl) {
            if (canonicalId && targetId && canonicalId !== targetId) {
                hintEl.style.display = 'block';
                hintEl.innerHTML = 'Source <code>' + escHtml(canonicalId)
                    + '</code> maps to <code>' + escHtml(targetId) + '</code> in export';
                hintEl.style.color = status === 'error' ? '#c62828' : '#54698d';
            } else {
                hintEl.style.display = 'none';
                hintEl.textContent = '';
            }
        }
    }

    /**
     * Collect selected attrs (with canonicalId for renames) and POST create.
     * @param {Object} opts
     * @param {Array} opts.pendingMissing
     * @param {string} opts.createAttrsUrl
     * @param {Function} opts.post - (url, body, cb)
     * @param {Function} [opts.onDone]
     */
    function createSelectedAttrs(opts) {
        var pendingMissing = opts.pendingMissing || [];
        var selected = [];
        var cbs = document.querySelectorAll('.acc-attr-cb');
        var c;
        for (c = 0; c < cbs.length; c++) {
            if (!cbs[c].checked) continue;
            var idx = parseInt(cbs[c].getAttribute('data-idx'), 10);
            var orig = pendingMissing[idx];
            if (!orig) continue;
            var idInput = document.querySelector('.cm-attr-id-input[data-idx="' + idx + '"]');
            var editedId = (idInput && idInput.value.trim()) ? idInput.value.trim() : orig.id;
            selected.push({
                id: editedId,
                canonicalId: orig.id,
                label: orig.label,
                ctpType: orig.ctpType || orig.sourceType,
                sfccType: readSfccType(idx, orig.sfccType),
                idx: idx
            });
        }
        if (!selected.length) return;

        var btn = document.getElementById('acc-create-attrs-btn');
        var msg = document.getElementById('acc-create-attrs-msg');
        if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

        opts.post(opts.createAttrsUrl, 'attrs=' + encodeURIComponent(JSON.stringify(selected)), function (data) {
            var r = (data && data.result) ? data.result : {};
            var failed = r.failed || 0;
            var created = r.created || 0;
            var exists = r.alreadyExists || 0;
            var results = r.results || [];
            var ri;

            for (ri = 0; ri < selected.length; ri++) {
                var sel = selected[ri];
                var rowResult = results[ri] || null;
                if (rowResult) {
                    setRowAttrFeedback(
                        sel.idx,
                        rowResult.status,
                        rowResult.canonicalId || sel.canonicalId,
                        rowResult.id || sel.id,
                        rowResult.message
                    );
                }
            }

            if (btn) {
                btn.disabled = false;
                btn.textContent = (data.ok && !failed) ? 'Done' : 'Retry';
            }
            if (msg) {
                if (!data.ok && data.error && !results.length) {
                    msg.textContent = data.error;
                    msg.style.color = '#c62828';
                } else {
                    var parts = [];
                    if (created) parts.push(created + ' created');
                    if (exists) parts.push(exists + ' already exists');
                    if (failed) parts.push(failed + ' failed');
                    msg.textContent = parts.length ? parts.join(', ') : (data.ok ? 'Done' : 'Failed');
                    if (r.errors && r.errors.length && failed) {
                        msg.textContent += ' — ' + r.errors.join('; ');
                    }
                    msg.style.color = failed || !data.ok ? '#c62828' : (exists && !created ? '#1565c0' : '#2e7d32');
                }
            }
            if (opts.onDone) opts.onDone(data, selected);
        });
    }

    /**
     * Render missing table into container and bind create/select-all.
     * @param {Object} opts
     * @param {HTMLElement} opts.container
     * @param {Array} opts.missing
     * @param {Object} opts.ui
     * @param {string} opts.createAttrsUrl
     * @param {Function} opts.post
     * @param {Function} [opts.getPending] - returns current pendingMissing array ref holder
     * @param {Function} [opts.setPending]
     */
    function renderMissingResults(opts) {
        var container = opts.container;
        var missing = opts.missing || [];
        var ui = opts.ui || {};
        if (!container) return;

        if (!missing.length) {
            container.innerHTML = '<p style="color:#2e7d32;font-size:13px;margin:0;">'
                + (ui.allAttrsExist || 'All attributes already exist in SFCC.') + '</p>';
            container.style.display = 'block';
            return;
        }

        container.innerHTML = missingTableHtml(missing, ui);
        container.style.display = 'block';

        var selectAllAttr = document.getElementById('acc-attr-select-all');
        var createBtn = document.getElementById('acc-create-attrs-btn');
        if (selectAllAttr) {
            selectAllAttr.addEventListener('change', function () {
                var cbs = document.querySelectorAll('.acc-attr-cb');
                var c;
                for (c = 0; c < cbs.length; c++) cbs[c].checked = this.checked;
            });
        }
        if (createBtn) {
            createBtn.addEventListener('click', function () {
                createSelectedAttrs({
                    pendingMissing: opts.getPending ? opts.getPending() : missing,
                    createAttrsUrl: opts.createAttrsUrl,
                    post: opts.post,
                    onDone: opts.onDone
                });
            });
        }
    }

    /**
     * Clear visit-scoped attr rename map when leaving the module.
     * @param {string} clearUrl - Accelerator-ClearAttrIdMap?module=...
     * @param {string} [keepPathFragment] - e.g. Accelerator-StoreMigration
     */
    function bindClearOnLeave(clearUrl, keepPathFragment) {
        if (!clearUrl) return;

        function clearMap() {
            try {
                if (navigator.sendBeacon) {
                    navigator.sendBeacon(clearUrl);
                    return;
                }
            } catch (e1) { /* fall through */ }
            try {
                var req = new XMLHttpRequest();
                req.open('GET', clearUrl, false);
                req.send(null);
            } catch (e2) { /* ignore */ }
        }

        window.addEventListener('pagehide', clearMap);

        var leaveLinks = document.querySelectorAll('a[href]');
        var li;
        for (li = 0; li < leaveLinks.length; li++) {
            leaveLinks[li].addEventListener('click', function () {
                var href = this.getAttribute('href') || '';
                if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return;
                if (keepPathFragment && href.indexOf(keepPathFragment) >= 0) return;
                clearMap();
            });
        }

        return clearMap;
    }

    global.AccAttrPreflight = {
        escHtml:              escHtml,
        sfccTypeSelectHtml:   sfccTypeSelectHtml,
        readSfccType:         readSfccType,
        readMigrationUi:      readMigrationUi,
        missingCountLabel:    missingCountLabel,
        missingBriefLabel:    missingBriefLabel,
        missingTableHtml:     missingTableHtml,
        setRowAttrFeedback:   setRowAttrFeedback,
        createSelectedAttrs:  createSelectedAttrs,
        renderMissingResults: renderMissingResults,
        bindClearOnLeave:     bindClearOnLeave
    };
}(typeof window !== 'undefined' ? window : this));
