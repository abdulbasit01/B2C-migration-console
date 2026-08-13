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
        return count + ((ui && ui.attrsMissingCount) || ' attribute(s) to create in SFCC:');
    }

    function missingBriefLabel(ui, count) {
        return count + ((ui && ui.attrsMissingBrief) || ' attribute(s) to create.');
    }

    function splitMapped(mapped) {
        var systemMapped = [];
        var alreadyExists = [];
        var i;
        for (i = 0; i < (mapped || []).length; i++) {
            var m = mapped[i];
            if (m && m.status === 'exists') {
                alreadyExists.push(m);
            } else {
                systemMapped.push(m);
            }
        }
        return { systemMapped: systemMapped, alreadyExists: alreadyExists };
    }

    /**
     * Summary strip: mapped / needs create / skipped / SFCC pending coverage.
     * @param {Object} counts
     * @returns {string}
     */
    function previewSummaryHtml(counts) {
        var mappedN = counts.systemMapped || 0;
        var existsN = counts.alreadyExists || 0;
        var missN = counts.missing || 0;
        var sugN = counts.suggested || 0;
        var skipN = counts.skipped || 0;
        var pendN = counts.coveragePending || 0;
        return ''
            + '<div style="margin:0 0 16px;padding:12px 14px;background:#f4f6f9;border:1px solid #e0e5ee;border-radius:6px;">'
            + '<div style="font-size:13px;font-weight:600;color:#16325c;margin:0 0 8px;">Attribute check preview</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:8px 16px;font-size:12px;color:#54698d;">'
            + '<span><strong style="color:#1565c0;">' + mappedN + '</strong> mapped to SFCC system (no create)</span>'
            + '<span><strong style="color:#2e7d32;">' + existsN + '</strong> already in SFCC (no create)</span>'
            + '<span><strong style="color:#6a1b9a;">' + sugN + '</strong> AI system-map suggestions</span>'
            + '<span><strong style="color:#e65100;">' + missN + '</strong> need create / map</span>'
            + '<span><strong style="color:#6d4c41;">' + skipN + '</strong> skipped (not attributes)</span>'
            + '<span><strong style="color:#6a6a6a;">' + pendN + '</strong> SFCC system with no source yet</span>'
            + '</div>'
            + '<p style="margin:10px 0 0;font-size:11px;color:#8a9ab8;line-height:1.4;">'
            + 'Mapped fields use existing SFCC system attributes. AI suggestions are possible system maps for create candidates - accept to map without creating, or leave unchecked and create as custom. '
            + 'Skipped fields are platform modes, nested structures, or data that migrates elsewhere (for example order XML) - do not create them. '
            + 'SFCC system fields with no source mapping are listed for visibility only - they are not created from this check.'
            + '</p></div>';
    }

    /**
     * @param {string} clearUrl
     * @returns {string}
     */
    function deriveSaveAttrMapUrl(clearUrl) {
        if (!clearUrl) return '';
        return String(clearUrl).replace('ClearAttrIdMap', 'SaveAttrIdMap');
    }

    /**
     * @param {Array} suggested
     * @returns {Object.<string, true>}
     */
    function suggestedIdSet(suggested) {
        var set = {};
        var i;
        for (i = 0; i < (suggested || []).length; i++) {
            if (suggested[i] && suggested[i].id) set[String(suggested[i].id)] = true;
        }
        return set;
    }

    /**
     * Status bar for inline AI validation (loading → done / error / skipped).
     * @param {string} state - pending|loading|ok|error|skipped
     * @param {string} [message]
     * @param {number} [suggestCount]
     * @returns {string}
     */
    function aiStatusBarHtml(state, message, suggestCount) {
        if (!state || state === 'skipped') {
            if (!message) return '';
            return '<div id="acc-ai-status-bar" style="margin:0 0 16px;padding:10px 14px;background:#f4f6f9;'
                + 'border:1px solid #e0e5ee;border-radius:6px;font-size:12px;color:#54698d;">'
                + escHtml(message) + '</div>';
        }
        var bg = '#f3e5f5';
        var border = '#ce93d8';
        var color = '#6a1b9a';
        var label = message || '';
        var spinner = '';
        if (state === 'pending' || state === 'loading') {
            label = label || 'Validating with AI...';
            spinner = '<span style="display:inline-block;width:12px;height:12px;margin-right:8px;'
                + 'border:2px solid #ce93d8;border-top-color:#6a1b9a;border-radius:50%;'
                + 'vertical-align:middle;animation:acc-ai-spin 0.8s linear infinite;"></span>';
        } else if (state === 'ok') {
            bg = '#f3e5f5';
            border = '#ab47bc';
            color = '#6a1b9a';
            label = label || ('Validated with AI'
                + (suggestCount ? (' — ' + suggestCount + ' suggestion(s)') : ''));
        } else if (state === 'error') {
            bg = '#ffebee';
            border = '#ef9a9a';
            color = '#c62828';
            label = label || 'AI validation failed';
        }
        return '<style>@keyframes acc-ai-spin{to{transform:rotate(360deg)}}</style>'
            + '<div id="acc-ai-status-bar" style="margin:0 0 16px;padding:10px 14px;background:' + bg + ';'
            + 'border:1px solid ' + border + ';border-radius:6px;font-size:12px;color:' + color + ';'
            + 'font-weight:600;">'
            + spinner + escHtml(label)
            + '</div>';
    }

    /**
     * AI suggestions: possible SFCC system targets for create candidates.
     * @param {Array} suggested
     * @param {Object} [ui]
     * @returns {string}
     */
    function suggestedTableHtml(suggested, ui) {
        if (!suggested || !suggested.length) return '';
        var html = '<details style="margin:0 0 16px;" open>'
            + '<summary style="cursor:pointer;font-size:13px;font-weight:600;color:#6a1b9a;margin:0 0 10px;">'
            + suggested.length + ' possible SFCC system mapping(s) (AI)'
            + '</summary>'
            + '<p style="font-size:12px;color:#8a9ab8;margin:0 0 10px;">'
            + 'OpenAI found possible system attributes for these create candidates. '
            + 'Pick a target and click Use mapping. Each SFCC system attribute can be mapped from only one source — '
            + 'Revert that mapping before assigning the same target to another source. '
            + 'You can Update mapping to a free target, or Revert and create as custom instead.'
            + '</p>'
            + '<div id="acc-ai-suggest-wrap" style="border:1px solid #ce93d8;border-radius:4px;overflow:hidden;margin-bottom:16px;'
            + 'background:#faf5fc;">'
            + '<table class="cm-attr-table"><thead><tr>'
            + '<th style="width:22%;">Source Attribute</th>'
            + '<th style="width:34%;">Possible SFCC attributes</th>'
            + '<th style="width:24%;">Action</th>'
            + '<th>Status</th>'
            + '</tr></thead><tbody>';
        var i;
        for (i = 0; i < suggested.length; i++) {
            var s = suggested[i];
            var targets = s.targets || [];
            var opts = '';
            var t;
            for (t = 0; t < targets.length; t++) {
                var tgt = targets[t];
                var confPct = Math.round((tgt.confidence || 0) * 100);
                var label = tgt.sfccField
                    + (tgt.reason ? ' — ' + tgt.reason : '')
                    + (confPct ? ' (' + confPct + '%)' : '');
                opts += '<option value="' + escHtml(tgt.sfccField) + '"'
                    + (t === 0 ? ' selected' : '') + '>'
                    + escHtml(label) + '</option>';
            }
            html += '<tr class="cm-ai-suggest-row" data-source-id="' + escHtml(s.id) + '" data-idx="' + i + '" '
                + 'style="background:#f3e5f5;">'
                + '<td><code style="color:#6a1b9a;font-weight:600;">' + escHtml(s.id) + '</code>'
                + (s.label && s.label !== s.id
                    ? '<div style="font-size:11px;color:#8a9ab8;margin-top:2px;">' + escHtml(s.label) + '</div>'
                    : '')
                + '</td>'
                + '<td><select class="cm-ai-target-select" data-idx="' + i + '" style="width:100%;max-width:100%;">'
                + opts + '</select></td>'
                + '<td style="white-space:nowrap;">'
                + '<button type="button" class="cm-btn cm-ai-use-map-btn" data-idx="' + i + '" '
                + 'style="font-size:12px;padding:4px 10px;margin-right:6px;">Use mapping</button>'
                + '<button type="button" class="cm-btn cm-ai-revert-btn" data-idx="' + i + '" '
                + 'style="font-size:12px;padding:4px 10px;display:none;">Revert</button>'
                + '</td>'
                + '<td><span class="cm-ai-suggest-status" data-idx="' + i + '" '
                + 'style="font-size:12px;color:#6a1b9a;">AI suggestion</span></td>'
                + '</tr>';
        }
        html += '</tbody></table></div>';
        if (ui && ui.aiMessage) {
            html += '<p style="font-size:11px;color:#8a9ab8;margin:0 0 10px;">' + escHtml(ui.aiMessage) + '</p>';
        }
        html += '</details>';
        return html;
    }

    /**
     * Read-only table of source attrs mapped to existing SFCC system fields.
     * @param {Array} mapped
     * @param {Object} ui
     * @param {string} [title]
     * @returns {string}
     */
    function mappedTableHtml(mapped, ui, title) {
        if (!mapped || !mapped.length) return '';
        var heading = title || (mapped.length + ((ui && ui.attrsMappedCount)
            || ' attribute(s) mapped to existing SFCC system fields'));
        // Drop trailing colon from older title strings used as summary labels
        heading = String(heading).replace(/:\s*$/, '');
        var html = '<details style="margin:0 0 16px;" open>'
            + '<summary style="cursor:pointer;font-size:13px;font-weight:600;color:#2e7d32;margin:0 0 10px;">'
            + escHtml(heading)
            + '</summary>'
            + '<div style="border:2px solid #43a047;border-radius:4px;overflow:hidden;margin-bottom:4px;'
            + 'background:#f1f8f4;box-shadow:0 0 0 1px #c8e6c9;">'
            + '<table class="cm-attr-table"><thead><tr>'
            + '<th style="width:22%;">Source Attribute</th>'
            + '<th style="width:18%;padding-left:20px;">SFCC Field</th>'
            + '<th style="width:22%;padding-left:20px;">Action</th>'
            + '<th>Note</th>'
            + '</tr></thead><tbody>';
        var i;
        for (i = 0; i < mapped.length; i++) {
            var m = mapped[i];
            var action = (m.status === 'exists')
                ? 'No create - already exists'
                : 'No create - use system field';
            html += '<tr>'
                + '<td><code>' + escHtml(m.id) + '</code></td>'
                + '<td style="padding-left:20px;"><code>' + escHtml(m.sfccField || '') + '</code></td>'
                + '<td style="font-size:12px;color:#2e7d32;padding-left:20px;">' + escHtml(action) + '</td>'
                + '<td style="font-size:12px;color:#54698d;">' + escHtml(m.note || 'Mapped - will not create a new attribute.') + '</td>'
                + '</tr>';
        }
        html += '</tbody></table></div></details>';
        return html;
    }

    /**
     * Source fields intentionally not created as SFCC attributes.
     * @param {Array} skipped
     * @returns {string}
     */
    function skippedTableHtml(skipped) {
        if (!skipped || !skipped.length) return '';
        var html = '<details style="margin:0 0 16px;" open>'
            + '<summary style="cursor:pointer;font-size:13px;font-weight:600;color:#757575;margin:0 0 10px;">'
            + skipped.length + ' source field(s) skipped (not created as attributes)'
            + '</summary>'
            + '<p style="font-size:12px;color:#9e9e9e;margin:0 0 10px;">'
            + 'These source fields are platform settings, nested objects, or data that migrates in XML / another flow. '
            + 'Do not create custom attributes for them.'
            + '</p>'
            + '<div style="border:2px solid #9e9e9e;border-radius:4px;overflow:hidden;'
            + 'background:#fafafa;box-shadow:0 0 0 1px #e0e0e0;">'
            + '<table class="cm-attr-table"><thead><tr>'
            + '<th style="width:22%;">Source Field</th>'
            + '<th style="width:22%;padding-left:20px;">Action</th>'
            + '<th>Why</th>'
            + '</tr></thead><tbody>';
        var i;
        for (i = 0; i < skipped.length; i++) {
            var s = skipped[i];
            html += '<tr>'
                + '<td><code>' + escHtml(s.id) + '</code></td>'
                + '<td style="font-size:12px;color:#757575;padding-left:20px;">Skip - do not create</td>'
                + '<td style="font-size:12px;color:#9e9e9e;">'
                + escHtml(s.note || 'Not created as an SFCC attribute.')
                + '</td></tr>';
        }
        html += '</tbody></table></div></details>';
        return html;
    }

    /**
     * SFCC system attrs with no source mapping (informational).
     * @param {Array} pending
     * @returns {string}
     */
    function coveragePendingTableHtml(pending) {
        if (!pending || !pending.length) return '';
        var html = '<details style="margin:0 0 16px;">'
            + '<summary style="cursor:pointer;font-size:13px;font-weight:600;color:#1565c0;margin:0 0 10px;">'
            + pending.length + ' SFCC system field(s) with no source mapping yet (informational)'
            + '</summary>'
            + '<p style="font-size:12px;color:#64b5f6;margin:0 0 10px;">'
            + 'These SFCC Order/object system attributes have no curated source field. '
            + 'They do not need create from this check.'
            + '</p>'
            + '<div style="border:2px solid #1e88e5;border-radius:4px;overflow:hidden;'
            + 'background:#e3f2fd;box-shadow:0 0 0 1px #90caf9;">'
            + '<table class="cm-attr-table"><thead><tr>'
            + '<th style="width:28%;">SFCC System Field</th>'
            + '<th style="width:18%;padding-left:20px;">Status</th>'
            + '<th>Note</th>'
            + '</tr></thead><tbody>';
        var i;
        for (i = 0; i < pending.length; i++) {
            var p = pending[i];
            html += '<tr>'
                + '<td><code>' + escHtml(p.id) + '</code></td>'
                + '<td style="font-size:12px;color:#1565c0;padding-left:20px;">No source map</td>'
                + '<td style="font-size:12px;color:#54698d;">'
                + escHtml(p.note || 'Not created from this check.')
                + '</td></tr>';
        }
        html += '</tbody></table></div></details>';
        return html;
    }

    /**
     * Build missing-attrs table HTML with rename + status columns.
     * @param {Array} missing
     * @param {Object} ui
     * @returns {string}
     */
    function missingTableHtml(missing, ui, suggestedIds) {
        suggestedIds = suggestedIds || {};
        var html = '<details style="margin:0 0 16px;" open>'
            + '<summary style="cursor:pointer;font-size:13px;font-weight:600;color:#f57f17;margin:0 0 10px;">'
            + escHtml(String(missingCountLabel(ui, missing.length)).replace(/:\s*$/, ''))
            + '</summary>'
            + '<p style="font-size:12px;color:#8a9ab8;margin:0 0 10px;">'
            + 'No curated SFCC system map - select rows to create as custom attributes and map on export. '
            + 'Rows highlighted in purple have AI suggestions above and start unchecked. '
            + 'A globe means the attribute will be created as <strong>localized</strong> (cannot change after create).'
            + '</p>'
            + '<div style="border:2px solid #f9a825;border-radius:4px;overflow:hidden;'
            + 'background:#fffde7;box-shadow:0 0 0 1px #ffe082;"><table class="cm-attr-table"><thead><tr>'
            + '<th style="width:36px;"><input type="checkbox" id="acc-attr-select-all"/></th>'
            + '<th>Attribute ID</th><th>Label</th><th>' + ((ui && ui.sourceTypeCol) || 'Source Type') + '</th>'
            + '<th>SFCC Type</th><th style="width:140px;">Status</th></tr></thead><tbody>';
        var i;
        for (i = 0; i < missing.length; i++) {
            var m = missing[i];
            var hasSuggest = !!(suggestedIds[String(m.id)]);
            var checked = hasSuggest ? '' : ' checked';
            var statusText = hasSuggest ? 'AI suggestion' : 'Needs create';
            var statusColor = hasSuggest ? '#6a1b9a' : '#8a9ab8';
            var rowStyle = hasSuggest
                ? ' style="background:#f3e5f5;border-left:3px solid #ab47bc;"'
                : '';
            var idStyle = hasSuggest
                ? ' style="color:#6a1b9a;font-weight:600;"'
                : '';
            var willLocalize = !!(m.localizable || m.scope === 'localized');
            var sourceWasLocalized = !!(m.sourceLocalizable && !willLocalize);
            var globeHtml = willLocalize
                ? ' <span class="cm-attr-globe" title="Localized — cannot change after create"'
                + ' style="font-size:14px;line-height:1;vertical-align:middle;"'
                + ' aria-label="Localized">&#127760;</span>'
                : '';
            var sourceNote = sourceWasLocalized
                ? '<div style="margin-top:4px;font-size:11px;color:#b26a00;line-height:1.35;">'
                + 'Source is localized; SFCC stores a single non-localized value on this object.'
                + '</div>'
                : '';
            html += '<tr class="cm-attr-row' + (hasSuggest ? ' cm-attr-row--ai' : '') + '" data-idx="' + i
                + '" data-id="' + escHtml(m.id) + '"'
                + (willLocalize ? ' data-localizable="1"' : '')
                + rowStyle + '>'
                + '<td style="text-align:center;"><input type="checkbox" class="acc-attr-cb" data-idx="' + i + '"'
                + checked + '/></td>'
                + '<td><input type="text" class="cm-attr-id-input" data-idx="' + i + '" data-canonical="'
                + escHtml(m.id) + '" value="' + escHtml(m.id) + '"' + idStyle + '/>'
                + globeHtml
                + (hasSuggest
                    ? '<div style="margin-top:4px;font-size:11px;color:#6a1b9a;font-weight:600;">Suggested by AI</div>'
                    : '')
                + sourceNote
                + '<div class="cm-attr-map-hint" data-idx="' + i + '" style="display:none;margin-top:4px;font-size:11px;color:#54698d;line-height:1.35;"></div></td>'
                + '<td>' + escHtml(m.label || m.id) + '</td>'
                + '<td style="color:#8a9ab8;">' + escHtml(m.ctpType || m.sourceType || '')
                + (willLocalize
                    ? ' <span style="color:#1565c0;font-size:11px;">(localized)</span>'
                    : '')
                + '</td>'
                + '<td>' + sfccTypeSelectHtml(m, i) + '</td>'
                + '<td><span class="cm-attr-status" data-idx="' + i + '" style="font-size:12px;color:'
                + statusColor + ';">' + escHtml(statusText) + '</span></td></tr>';
        }
        html += '</tbody></table></div>'
            + '<div style="margin-top:14px;"><button type="button" id="acc-create-attrs-btn" class="cm-btn cm-btn--primary">Create Selected Attributes</button>'
            + '<span id="acc-create-attrs-msg" style="font-size:13px;color:#54698d;margin-left:12px;"></span></div>'
            + '</details>';
        return html;
    }

    /**
     * SFCC targets already claimed by an accepted AI map: field -> sourceId.
     * @returns {Object.<string, string>}
     */
    function getClaimedSfccTargets() {
        var claimed = {};
        var rows = document.querySelectorAll('.cm-ai-suggest-row[data-mapped-to]');
        var i;
        for (i = 0; i < rows.length; i++) {
            var field = rows[i].getAttribute('data-mapped-to');
            var sourceId = rows[i].getAttribute('data-source-id');
            if (field && sourceId) claimed[field] = sourceId;
        }
        return claimed;
    }

    /**
     * Disable SFCC options already mapped by another source; keep this row's own claim selectable.
     */
    function refreshAiTargetAvailability() {
        var claimed = getClaimedSfccTargets();
        var selects = document.querySelectorAll('.cm-ai-target-select');
        var s;
        for (s = 0; s < selects.length; s++) {
            var sel = selects[s];
            var idx = sel.getAttribute('data-idx');
            var row = document.querySelector('.cm-ai-suggest-row[data-idx="' + idx + '"]');
            var ownSource = row ? row.getAttribute('data-source-id') : '';
            var ownMapped = row ? (row.getAttribute('data-mapped-to') || '') : '';
            var o;
            var firstFree = '';
            for (o = 0; o < sel.options.length; o++) {
                var opt = sel.options[o];
                var val = opt.value;
                var baseLabel = opt.getAttribute('data-base-label') || opt.text;
                if (!opt.getAttribute('data-base-label')) {
                    opt.setAttribute('data-base-label', opt.text);
                    baseLabel = opt.text;
                }
                var takenBy = claimed[val];
                var takenByOther = !!(takenBy && takenBy !== ownSource);
                opt.disabled = takenByOther;
                if (takenByOther) {
                    opt.text = baseLabel + ' (in use by ' + takenBy + ')';
                } else {
                    opt.text = baseLabel;
                }
                if (!takenByOther && !firstFree) firstFree = val;
            }
            // If current selection is taken by someone else, move to first free option
            if (sel.selectedIndex >= 0 && sel.options[sel.selectedIndex].disabled) {
                if (ownMapped && !sel.querySelector('option[value="' + ownMapped + '"]:disabled')) {
                    sel.value = ownMapped;
                } else if (firstFree) {
                    sel.value = firstFree;
                }
            }
            // Disable Use/Update when no free targets (and not already mapped on this row)
            var useBtn = document.querySelector('.cm-ai-use-map-btn[data-idx="' + idx + '"]');
            if (useBtn && !ownMapped) {
                var hasFree = false;
                for (o = 0; o < sel.options.length; o++) {
                    if (!sel.options[o].disabled) { hasFree = true; break; }
                }
                useBtn.disabled = !hasFree;
                if (!hasFree) {
                    var statusEl = document.querySelector('.cm-ai-suggest-status[data-idx="' + idx + '"]');
                    if (statusEl && statusEl.textContent.indexOf('Mapped') !== 0) {
                        statusEl.textContent = 'No free SFCC targets (revert another mapping)';
                        statusEl.style.color = '#8a9ab8';
                    }
                }
            }
        }
    }

    /**
     * Update create-table row after AI map accept/revert.
     * @param {string} sourceId
     * @param {string} mode - 'mapped'|'suggestion'
     * @param {string} [sfccField]
     */
    function syncCreateRowForAi(sourceId, mode, sfccField) {
        var rows = document.querySelectorAll('.cm-attr-row[data-id]');
        var r;
        for (r = 0; r < rows.length; r++) {
            if (rows[r].getAttribute('data-id') !== sourceId) continue;
            var rowIdx = rows[r].getAttribute('data-idx');
            var cb = document.querySelector('.acc-attr-cb[data-idx="' + rowIdx + '"]');
            var statusEl = document.querySelector('.cm-attr-status[data-idx="' + rowIdx + '"]');
            var hintEl = document.querySelector('.cm-attr-map-hint[data-idx="' + rowIdx + '"]');
            if (mode === 'mapped') {
                if (cb) cb.checked = false;
                if (statusEl) {
                    statusEl.textContent = 'Mapped via AI';
                    statusEl.style.color = '#2e7d32';
                }
                setRowAttrFeedback(rowIdx, 'exists', sourceId, sfccField, 'Mapped via AI suggestion');
            } else {
                if (cb) cb.checked = false;
                if (statusEl) {
                    statusEl.textContent = 'AI suggestion';
                    statusEl.style.color = '#6a1b9a';
                    statusEl.title = '';
                }
                if (hintEl) {
                    hintEl.style.display = 'none';
                    hintEl.textContent = '';
                }
            }
        }
    }

    /**
     * Persist accepted AI map (source → SFCC system) via SaveAttrIdMap.
     * Can be called again to change the target.
     * @param {Object} opts
     */
    function acceptAiSuggestion(opts) {
        var saveUrl = opts.saveAttrMapUrl || '';
        var sourceId = opts.sourceId || '';
        var sfccField = opts.sfccField || '';
        var idx = opts.idx;
        var post = opts.post;
        var statusEl = document.querySelector('.cm-ai-suggest-status[data-idx="' + idx + '"]');
        var btn = document.querySelector('.cm-ai-use-map-btn[data-idx="' + idx + '"]');
        var revertBtn = document.querySelector('.cm-ai-revert-btn[data-idx="' + idx + '"]');
        var row = document.querySelector('.cm-ai-suggest-row[data-idx="' + idx + '"]');
        if (!saveUrl || !sourceId || !sfccField || !post) {
            if (statusEl) {
                statusEl.textContent = 'Save URL unavailable';
                statusEl.style.color = '#c62828';
            }
            return;
        }
        var claimed = getClaimedSfccTargets();
        var takenBy = claimed[sfccField];
        if (takenBy && takenBy !== sourceId) {
            if (statusEl) {
                statusEl.textContent = 'Already mapped from ' + takenBy + ' — revert that first';
                statusEl.style.color = '#c62828';
            }
            return;
        }
        if (btn) btn.disabled = true;
        var payload = [{ canonicalId: sourceId, id: sfccField }];
        post(saveUrl, 'attrs=' + encodeURIComponent(JSON.stringify(payload)), function (data) {
            if (btn) btn.disabled = false;
            if (data && data.ok) {
                if (statusEl) {
                    statusEl.textContent = 'Mapped to ' + sfccField;
                    statusEl.style.color = '#2e7d32';
                }
                if (btn) {
                    btn.textContent = 'Update mapping';
                    btn.disabled = false;
                }
                if (revertBtn) revertBtn.style.display = 'inline-block';
                if (row) row.setAttribute('data-mapped-to', sfccField);
                syncCreateRowForAi(sourceId, 'mapped', sfccField);
                refreshAiTargetAvailability();
                if (opts.onAccepted) opts.onAccepted(sourceId, sfccField, data);
            } else {
                if (statusEl) {
                    statusEl.textContent = (data && data.error) || 'Save failed';
                    statusEl.style.color = '#c62828';
                }
            }
        });
    }

    /**
     * Undo an accepted AI map (clear session remap; restore suggestion state).
     * @param {Object} opts
     */
    function revertAiSuggestion(opts) {
        var saveUrl = opts.saveAttrMapUrl || '';
        var sourceId = opts.sourceId || '';
        var idx = opts.idx;
        var post = opts.post;
        var statusEl = document.querySelector('.cm-ai-suggest-status[data-idx="' + idx + '"]');
        var btn = document.querySelector('.cm-ai-use-map-btn[data-idx="' + idx + '"]');
        var revertBtn = document.querySelector('.cm-ai-revert-btn[data-idx="' + idx + '"]');
        var row = document.querySelector('.cm-ai-suggest-row[data-idx="' + idx + '"]');
        if (!saveUrl || !sourceId || !post) {
            if (statusEl) {
                statusEl.textContent = 'Save URL unavailable';
                statusEl.style.color = '#c62828';
            }
            return;
        }
        if (revertBtn) revertBtn.disabled = true;
        // id === canonicalId clears the remap in saveFromAttrs
        var payload = [{ canonicalId: sourceId, id: sourceId, remove: true }];
        post(saveUrl, 'attrs=' + encodeURIComponent(JSON.stringify(payload)), function (data) {
            if (revertBtn) revertBtn.disabled = false;
            if (data && data.ok) {
                if (statusEl) {
                    statusEl.textContent = 'AI suggestion';
                    statusEl.style.color = '#6a1b9a';
                }
                if (btn) {
                    btn.textContent = 'Use mapping';
                    btn.disabled = false;
                }
                if (revertBtn) revertBtn.style.display = 'none';
                if (row) row.removeAttribute('data-mapped-to');
                syncCreateRowForAi(sourceId, 'suggestion');
                refreshAiTargetAvailability();
                if (opts.onReverted) opts.onReverted(sourceId, data);
            } else {
                if (statusEl) {
                    statusEl.textContent = (data && data.error) || 'Revert failed';
                    statusEl.style.color = '#c62828';
                }
            }
        });
    }

    /**
     * Re-apply exclusive session AI maps onto suggestion rows after Check / AI load.
     * @param {Array<{sourceId: string, sfccField: string}>} sessionMaps
     */
    function applySessionSystemMaps(sessionMaps) {
        if (!sessionMaps || !sessionMaps.length) {
            refreshAiTargetAvailability();
            return;
        }
        var i;
        for (i = 0; i < sessionMaps.length; i++) {
            var sm = sessionMaps[i];
            if (!sm || !sm.sourceId || !sm.sfccField) continue;
            var row = document.querySelector(
                '.cm-ai-suggest-row[data-source-id="' + sm.sourceId.replace(/"/g, '') + '"]'
            );
            if (!row) continue;
            var idx = row.getAttribute('data-idx');
            var sel = document.querySelector('.cm-ai-target-select[data-idx="' + idx + '"]');
            var statusEl = document.querySelector('.cm-ai-suggest-status[data-idx="' + idx + '"]');
            var btn = document.querySelector('.cm-ai-use-map-btn[data-idx="' + idx + '"]');
            var revertBtn = document.querySelector('.cm-ai-revert-btn[data-idx="' + idx + '"]');
            if (sel) {
                var opt = null;
                var o;
                for (o = 0; o < sel.options.length; o++) {
                    if (sel.options[o].value === sm.sfccField) { opt = sel.options[o]; break; }
                }
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = sm.sfccField;
                    opt.text = sm.sfccField + ' (session map)';
                    opt.setAttribute('data-base-label', opt.text);
                    sel.appendChild(opt);
                }
                sel.value = sm.sfccField;
            }
            row.setAttribute('data-mapped-to', sm.sfccField);
            if (statusEl) {
                statusEl.textContent = 'Mapped to ' + sm.sfccField;
                statusEl.style.color = '#2e7d32';
            }
            if (btn) {
                btn.textContent = 'Update mapping';
                btn.disabled = false;
            }
            if (revertBtn) revertBtn.style.display = 'inline-block';
            syncCreateRowForAi(sm.sourceId, 'mapped', sm.sfccField);
        }
        refreshAiTargetAvailability();
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
                localizable: !!(orig.localizable || orig.scope === 'localized'),
                siteSpecific: !!orig.siteSpecific,
                sourceLocalizable: !!orig.sourceLocalizable,
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
                        msg.textContent += ' - ' + r.errors.join('; ');
                    }
                    msg.style.color = failed || !data.ok ? '#c62828' : (exists && !created ? '#1565c0' : '#2e7d32');
                }
            }
            if (opts.onDone) opts.onDone(data, selected);
        });
    }

    /**
     * Render mapped (read-only) + missing (create) + skipped + coverage pending preview.
     * @param {Object} opts
     */
    function renderMissingResults(opts) {
        var container = opts.container;
        var mapped = opts.mapped || [];
        var missing = opts.missing || [];
        var suggested = opts.suggested || [];
        var coveragePending = opts.coveragePending || [];
        var skipped = opts.skipped || [];
        var ui = opts.ui || {};
        var aiStatus = opts.aiStatus || 'skipped';
        var aiMessage = opts.aiMessage || '';
        var saveAttrMapUrl = opts.saveAttrMapUrl
            || deriveSaveAttrMapUrl(opts.clearAttrMapUrl || '');
        var suggestUrl = opts.suggestAttrMapsUrl || '';
        var taskName = opts.taskName || '';
        var sfccObjectType = opts.sfccObjectType || '';
        var sugIds = suggestedIdSet(suggested);
        var split = splitMapped(mapped);
        if (!container) return;

        if (!mapped.length && !missing.length && !suggested.length
            && !coveragePending.length && !skipped.length) {
            container.innerHTML = '<div style="padding:12px 14px;background:#f4f6f9;border:1px solid #e0e5ee;border-radius:6px;">'
                + '<p style="color:#54698d;font-size:13px;margin:0 0 8px;font-weight:600;">No attributes returned from this check</p>'
                + '<p style="color:#8a9ab8;font-size:12px;margin:0;line-height:1.4;">'
                + (ui.allAttrsExistDetail
                    || 'No source custom-type fields were found, and no curated system maps were applied. '
                        + 'For commercetools Order, built-in fields are mapped via nativeFieldMap; custom fields come from CT Types with resourceTypeId "order".')
                + '</p></div>';
            container.style.display = 'block';
            return;
        }

        var barState = aiStatus;
        var barMsg = aiMessage;
        if (aiStatus === 'pending') {
            barState = 'loading';
            barMsg = 'Validating with AI...';
        } else if (aiStatus === 'ok') {
            barMsg = 'Validated with AI'
                + (suggested.length ? (' — ' + suggested.length + ' suggestion(s)') : ' — no system-map matches');
        } else if (aiStatus === 'error') {
            barMsg = aiMessage || 'AI validation failed';
        }

        var html = previewSummaryHtml({
            systemMapped: split.systemMapped.length,
            alreadyExists: split.alreadyExists.length,
            suggested: suggested.length,
            missing: missing.length,
            skipped: skipped.length,
            coveragePending: coveragePending.length
        });
        html += aiStatusBarHtml(barState, barMsg, suggested.length);

        if (split.systemMapped.length) {
            html += mappedTableHtml(
                split.systemMapped,
                ui,
                split.systemMapped.length + ' mapped to SFCC system attributes (no create):'
            );
        }
        if (split.alreadyExists.length) {
            html += mappedTableHtml(
                split.alreadyExists,
                ui,
                split.alreadyExists.length + ' already exist in SFCC (no create):'
            );
        }
        if (suggested.length) {
            html += suggestedTableHtml(suggested, ui);
        }
        if (missing.length) {
            html += missingTableHtml(missing, ui, sugIds);
        } else if (mapped.length || suggested.length) {
            html += '<p style="color:#2e7d32;font-size:13px;margin:0 0 16px;">'
                + (ui.noAttrsToCreate || 'No attributes need to be created.') + '</p>';
        }
        html += skippedTableHtml(skipped);
        html += coveragePendingTableHtml(coveragePending);

        container.innerHTML = html;
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

        var useBtns = document.querySelectorAll('.cm-ai-use-map-btn');
        var bi;
        for (bi = 0; bi < useBtns.length; bi++) {
            useBtns[bi].addEventListener('click', function () {
                var idx = parseInt(this.getAttribute('data-idx'), 10);
                var row = suggested[idx];
                if (!row) return;
                var sel = document.querySelector('.cm-ai-target-select[data-idx="' + idx + '"]');
                var target = sel ? sel.value : ((row.targets && row.targets[0] && row.targets[0].sfccField) || '');
                acceptAiSuggestion({
                    saveAttrMapUrl: saveAttrMapUrl,
                    sourceId: row.id,
                    sfccField: target,
                    idx: idx,
                    post: opts.post,
                    onAccepted: opts.onAiAccepted
                });
            });
        }

        var revertBtns = document.querySelectorAll('.cm-ai-revert-btn');
        var ri;
        for (ri = 0; ri < revertBtns.length; ri++) {
            revertBtns[ri].addEventListener('click', function () {
                var idx = parseInt(this.getAttribute('data-idx'), 10);
                var row = suggested[idx];
                if (!row) return;
                revertAiSuggestion({
                    saveAttrMapUrl: saveAttrMapUrl,
                    sourceId: row.id,
                    idx: idx,
                    post: opts.post,
                    onReverted: opts.onAiReverted
                });
            });
        }

        applySessionSystemMaps(opts.sessionSystemMaps || []);

        // Inline AI follow-up after first check paint
        if (aiStatus === 'pending' && missing.length && suggestUrl && opts.post && !opts._aiRequested) {
            var followOpts = {};
            var fk;
            for (fk in opts) {
                if (Object.prototype.hasOwnProperty.call(opts, fk)) followOpts[fk] = opts[fk];
            }
            followOpts._aiRequested = true;
            followOpts.aiStatus = 'loading';
            var excludeFields = [];
            var em;
            for (em = 0; em < (mapped || []).length; em++) {
                if (mapped[em] && mapped[em].sfccField) {
                    excludeFields.push(mapped[em].sfccField);
                }
            }
            var sm;
            for (sm = 0; sm < (opts.sessionSystemMaps || []).length; sm++) {
                if (opts.sessionSystemMaps[sm] && opts.sessionSystemMaps[sm].sfccField) {
                    excludeFields.push(opts.sessionSystemMaps[sm].sfccField);
                }
            }
            var body = 'task=' + encodeURIComponent(taskName)
                + '&sfccObjectType=' + encodeURIComponent(sfccObjectType)
                + '&attrs=' + encodeURIComponent(JSON.stringify(missing))
                + '&excludeSfccFields=' + encodeURIComponent(JSON.stringify(excludeFields));
            opts.post(suggestUrl, body, function (data) {
                followOpts.suggested = (data && data.suggested) || [];
                followOpts.aiStatus = (data && data.aiStatus) || (data && data.ok ? 'ok' : 'error');
                followOpts.aiMessage = (data && (data.aiMessage || data.error)) || '';
                if (followOpts.aiMessage === 'Parse error') {
                    followOpts.aiMessage = 'AI endpoint returned non-JSON (check Accelerator-SuggestAttrMaps is registered in bm_extensions.xml and cartridge is uploaded)';
                }
                if (followOpts.aiStatus === 'skipped' && followOpts.suggested.length) {
                    followOpts.aiStatus = 'ok';
                }
                if (followOpts.aiStatus === 'skipped' && !followOpts.suggested.length) {
                    followOpts.aiMessage = followOpts.aiMessage || 'AI returned no suggestions';
                }
                if (data && data.ok !== false && followOpts.aiStatus !== 'error') {
                    if (followOpts.aiStatus !== 'skipped') followOpts.aiStatus = 'ok';
                }
                // Keep session maps from the original check so UI can restore exclusive accepts
                followOpts.sessionSystemMaps = opts.sessionSystemMaps || [];
                renderMissingResults(followOpts);
            });
        }
    }

    /**
     * Clear visit-scoped attr rename map when leaving the module.
     * @param {string} clearUrl
     * @param {string} [keepPathFragment]
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
        mappedTableHtml:      mappedTableHtml,
        missingTableHtml:     missingTableHtml,
        suggestedTableHtml:   suggestedTableHtml,
        aiStatusBarHtml:      aiStatusBarHtml,
        skippedTableHtml:     skippedTableHtml,
        setRowAttrFeedback:   setRowAttrFeedback,
        createSelectedAttrs:  createSelectedAttrs,
        acceptAiSuggestion:   acceptAiSuggestion,
        revertAiSuggestion:   revertAiSuggestion,
        renderMissingResults: renderMissingResults,
        bindClearOnLeave:     bindClearOnLeave
    };
}(typeof window !== 'undefined' ? window : this));
