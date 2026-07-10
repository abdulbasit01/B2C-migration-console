/**
 * Tax migration — overview rows + per-class table, full export to SFCC IMPEX.
 */
(function () {
    'use strict';

    function readUi(root) {
        if (window.AccAttrPreflight && window.AccAttrPreflight.readMigrationUi) {
            var fromJson = window.AccAttrPreflight.readMigrationUi();
            if (fromJson && fromJson.sourceShort) return fromJson;
        }
        if (!root) return {};
        try {
            var raw = root.getAttribute('data-migration-ui');
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    function readCfg() {
        var root = document.getElementById('acc-tx-root');
        if (!root) return { ui: {} };
        return {
            fullBatchUrl:       root.getAttribute('data-full-batch-url') || '',
            summaryUrl:         root.getAttribute('data-summary-url') || '',
            checkAttrsUrl:      root.getAttribute('data-check-attrs-url') || '',
            createAttrsUrl:     root.getAttribute('data-create-attrs-url') || '',
            dataWizardEntryUrl: root.getAttribute('data-wizard-entry-url') || '',
            impexPath:          root.getAttribute('data-impex-path') || '',
            ui:                 readUi(root)
        };
    }

    function escHtml(val) {
        if (val === null || val === undefined) return '';
        return String(val)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function parseJsonResponse(raw, fallbackError) {
        if (!raw || !String(raw).trim()) {
            return { ok: false, error: fallbackError || 'Empty response from server' };
        }
        try {
            return JSON.parse(raw);
        } catch (e) {
            var snippet = String(raw).replace(/\s+/g, ' ').substring(0, 180);
            return {
                ok:    false,
                error: 'Server returned non-JSON (session timeout?). ' + snippet
            };
        }
    }

    function get(url, onDone) {
        if (!url) {
            onDone({ ok: false, error: 'API URL not configured' });
            return;
        }
        var req = new XMLHttpRequest();
        req.open('GET', url, true);
        req.onreadystatechange = function () {
            if (req.readyState !== 4) return;
            onDone(parseJsonResponse(req.responseText, 'Parse error'));
        };
        req.onerror = function () { onDone({ ok: false, error: 'Network error' }); };
        req.send(null);
    }

    function post(url, params, onDone) {
        if (!url) {
            onDone({ ok: false, error: 'API URL not configured' });
            return;
        }
        var req = new XMLHttpRequest();
        req.open('POST', url, true);
        req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.onreadystatechange = function () {
            if (req.readyState !== 4) return;
            onDone(parseJsonResponse(req.responseText, 'Parse error'));
        };
        req.onerror = function () { onDone({ ok: false, error: 'Network error' }); };
        req.send(params);
    }

    function todayStamp() {
        var d = new Date();
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate());
    }

    function defaultFileName() {
        return 'tax-full-' + todayStamp() + '-v001.xml';
    }

    function boot() {
        var cfg = readCfg();
        var ui  = cfg.ui || {};
        var loadingEl = document.getElementById('acc-tx-loading');
        var errorEl = document.getElementById('acc-tx-error');
        var overviewWrap = document.getElementById('acc-tx-overview-wrap');
        var classLabelsEl = document.getElementById('acc-tx-class-labels');
        var countryLabelsEl = document.getElementById('acc-tx-country-labels');
        var tableWrap = document.getElementById('acc-tx-table-wrap');
        var tbody = document.getElementById('acc-tx-tbody');
        var summaryEl = document.getElementById('acc-tx-summary');
        var fileNameEl = document.getElementById('acc-tx-file-name');
        var reloadBtn = document.getElementById('acc-reload-tax-btn');
        var startBtn = document.getElementById('full-start-btn');
        var fullOverallEl = document.getElementById('full-move-overall');
        var fullPhaseList = document.getElementById('full-phase-list');
        var checkAttrsBtn = document.getElementById('acc-check-attrs-btn');
        var attrCheckMsg = document.getElementById('acc-attr-check-msg');
        var attrResults = document.getElementById('acc-attr-results');
        var preflightModal = document.getElementById('acc-preflight-modal');
        var modalAttrList = document.getElementById('acc-modal-attr-list');
        var modalSkipBtn = document.getElementById('acc-modal-skip');
        var modalCreateBtn = document.getElementById('acc-modal-create');

        var overview = null;
        var fileName = defaultFileName();
        var fullRunning = false;
        var fullFinished = false;
        var pendingMissing = [];
        var modalCallback = null;

        function setPhase(prefix, id, state, detail, pct) {
            var li  = document.getElementById(prefix + '-phase-' + id);
            var st  = document.getElementById(prefix + '-status-' + id);
            var det = document.getElementById(prefix + '-detail-' + id);
            var bar = document.getElementById(prefix + '-bar-' + id);
            if (!li) return;
            li.className = 'acc-phases__item acc-phases__item--' + state;
            if (st)  st.textContent = state;
            if (det && detail !== null) det.textContent = detail || '';
            if (bar) bar.style.width = (pct || 0) + '%';
        }

        function renderOverview(data) {
            overview = data.overview || null;
            if (!overview) return;

            if (classLabelsEl) {
                classLabelsEl.textContent = overview.classLabels || 'None found';
            }
            if (countryLabelsEl) {
                countryLabelsEl.textContent = overview.countryLabels || 'None found';
            }
            if (fileNameEl) fileNameEl.textContent = fileName;

            if (summaryEl) {
                var parts = [];
                if (overview.classCount) parts.push(overview.classCount + ' class(es)');
                if (overview.rateCount) {
                    parts.push(overview.rateCount + ' jurisdiction(s)');
                    if (overview.nonZeroRateCount != null && overview.nonZeroRateCount < overview.rateCount) {
                        parts.push(overview.nonZeroRateCount + ' non-zero');
                    }
                }
                summaryEl.textContent = parts.length ? parts.join(', ') : 'No tax data';
                summaryEl.style.color = overview.rateCount ? '#2e7d32' : '#e65100';
            }

            var rows = overview.rows || [];
            if (tbody && rows.length) {
                var html = '';
                var i;
                for (i = 0; i < rows.length; i++) {
                    var row = rows[i];
                    html += '<tr>'
                        + '<td><strong>' + escHtml(row.className || row.classKey) + '</strong>'
                        + (row.classKey && row.classKey !== row.className
                            ? '<br/><code>' + escHtml(row.classKey) + '</code>' : '')
                        + '</td>'
                        + '<td style="font-size:12px;color:#54698d;">'
                        + (row.countryLabels ? escHtml(row.countryLabels) : '&mdash;')
                        + '</td>'
                        + '<td style="white-space:nowrap;">' + String(row.rateCount != null ? row.rateCount : 0) + '</td>'
                        + '</tr>';
                }
                tbody.innerHTML = html;
                if (tableWrap) tableWrap.style.display = 'block';
            } else if (tableWrap) {
                tableWrap.style.display = 'none';
            }

            if (loadingEl) loadingEl.style.display = 'none';
            if (errorEl) errorEl.style.display = 'none';
            if (overviewWrap) overviewWrap.style.display = 'block';

            if (startBtn) {
                startBtn.disabled = !overview.rateCount;
            }
            if (!overview.rateCount && errorEl) {
                errorEl.style.display = 'block';
                errorEl.textContent = ui.noTaxRates || 'No tax jurisdictions found.';
            } else if (overview.rateCount && !overview.nonZeroRateCount && errorEl) {
                errorEl.style.display = 'block';
                errorEl.style.color = '#e65100';
                errorEl.textContent = ui.taxAllRatesZero || 'All jurisdictions will export at 0%.';
            } else if (errorEl) {
                errorEl.style.display = 'none';
            }
        }

        function loadOverview(fromUserClick) {
            if (!cfg.summaryUrl) {
                if (loadingEl) loadingEl.style.display = 'none';
                if (errorEl) {
                    errorEl.style.display = 'block';
                    errorEl.textContent = 'Tax overview API URL is missing. Hard-refresh the page (Ctrl+Shift+R).';
                }
                return;
            }

            if (loadingEl) {
                loadingEl.style.display = 'block';
                loadingEl.textContent = fromUserClick
                    ? (ui.reloadingTax || 'Reloading...')
                    : (ui.loadingTax || 'Loading tax data...');
            }
            if (errorEl) errorEl.style.display = 'none';
            if (overviewWrap) overviewWrap.style.display = 'none';
            if (startBtn) startBtn.disabled = true;
            if (reloadBtn) {
                reloadBtn.disabled = true;
                reloadBtn.textContent = 'Loading...';
            }

            get(cfg.summaryUrl, function (data) {
                if (reloadBtn) {
                    reloadBtn.disabled = false;
                    reloadBtn.textContent = ui.reloadTaxBtn || ui.loadTaxBtn || 'Reload';
                }
                if (!data.ok) {
                    if (loadingEl) loadingEl.style.display = 'none';
                    if (errorEl) {
                        errorEl.style.display = 'block';
                        errorEl.textContent = 'Failed to load: ' + (data.error || 'Unknown error');
                    }
                    return;
                }
                fileName = defaultFileName();
                renderOverview(data);
            });
        }

        function renderAttrResults(missing) {
            if (!attrResults) return;
            attrResults.innerHTML = '';
            attrResults.style.display = 'block';
            if (!missing.length) {
                attrResults.innerHTML = '<p style="color:#2e7d32;font-size:13px;margin:0;">' + (ui.allAttrsExist || 'All attributes already exist in SFCC.') + '</p>';
                return;
            }
            if (!window.AccAttrPreflight) {
                attrResults.innerHTML = '<p style="color:#c62828;font-size:13px;margin:0;">Attribute helper script failed to load.</p>';
                return;
            }
            var html = '<p style="font-size:13px;color:#54698d;margin:0 0 10px;">'
                + (window.AccAttrPreflight ? window.AccAttrPreflight.missingCountLabel(ui, missing.length) : missing.length + (ui.attrsMissingCount || ' attribute(s) missing in SFCC:'))
                + '</p>';
            html += '<div style="border:1px solid #e0e5ee;border-radius:4px;overflow:hidden;"><table class="cm-attr-table"><thead><tr>'
                + '<th style="width:36px;"><input type="checkbox" id="acc-attr-select-all" checked/></th>'
                + '<th>Attribute ID</th><th>Label</th><th>' + (ui.sourceTypeCol || 'Source Type') + '</th><th>SFCC Type</th></tr></thead><tbody>';
            var i;
            for (i = 0; i < missing.length; i++) {
                var m = missing[i];
                html += '<tr><td style="text-align:center;"><input type="checkbox" class="acc-attr-cb" data-idx="' + i + '" checked/></td>'
                    + '<td><input type="text" class="cm-attr-id-input" data-idx="' + i + '" value="' + escHtml(m.id) + '"/></td>'
                    + '<td>' + escHtml(m.label || m.id) + '</td>'
                    + '<td style="color:#8a9ab8;">' + escHtml(m.ctpType) + '</td>'
                    + '<td>' + window.AccAttrPreflight.sfccTypeSelectHtml(m, i) + '</td></tr>';
            }
            html += '</tbody></table></div>';
            html += '<div style="margin-top:14px;"><button type="button" id="acc-create-attrs-btn" class="cm-btn cm-btn--primary">Create Selected Attributes</button>'
                + '<span id="acc-create-attrs-msg" style="font-size:13px;color:#54698d;margin-left:12px;"></span></div>';
            attrResults.innerHTML = html;

            var selectAllAttr = document.getElementById('acc-attr-select-all');
            var createBtn = document.getElementById('acc-create-attrs-btn');
            if (selectAllAttr) {
                selectAllAttr.addEventListener('change', function () {
                    var cbs = document.querySelectorAll('.acc-attr-cb');
                    var c;
                    for (c = 0; c < cbs.length; c++) cbs[c].checked = this.checked;
                });
            }
            if (createBtn) createBtn.addEventListener('click', createSelectedAttrs);
        }

        function createSelectedAttrs() {
            var selected = [];
            var cbs = document.querySelectorAll('.acc-attr-cb');
            var c;
            for (c = 0; c < cbs.length; c++) {
                if (cbs[c].checked) {
                    var idx = parseInt(cbs[c].getAttribute('data-idx'), 10);
                    var orig = pendingMissing[idx];
                    var idInput = document.querySelector('.cm-attr-id-input[data-idx="' + idx + '"]');
                    selected.push({
                        id: orig.id,
                        label: orig.label,
                        ctpType: orig.ctpType,
                        sfccType: window.AccAttrPreflight.readSfccType(idx, orig.sfccType)
                    });
                    if (idInput && idInput.value.trim()) {
                        selected[selected.length - 1].id = idInput.value.trim();
                    }
                }
            }
            if (!selected.length) return;
            var btn = document.getElementById('acc-create-attrs-btn');
            var msg = document.getElementById('acc-create-attrs-msg');
            if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
            post(cfg.createAttrsUrl, 'attrs=' + encodeURIComponent(JSON.stringify(selected)), function (data) {
                if (btn) { btn.disabled = false; btn.textContent = data.ok ? 'Done' : 'Retry'; }
                if (msg) {
                    msg.textContent = data.ok ? ((data.result.created || 0) + ' created') : (data.error || 'Failed');
                    msg.style.color = data.ok ? '#2e7d32' : '#c62828';
                }
            });
        }

        function runPreflightThenMigrate(onContinue) {
            get(cfg.checkAttrsUrl, function (data) {
                if (!data.ok || !data.missing || !data.missing.length) {
                    onContinue();
                    return;
                }
                if (modalAttrList) {
                    modalAttrList.innerHTML = '<p style="font-size:13px;color:#54698d;">'
                        + (window.AccAttrPreflight ? window.AccAttrPreflight.missingBriefLabel(ui, data.missing.length) : data.missing.length + (ui.attrsMissingBrief || ' attribute(s) missing.'))
                        + '</p>';
                }
                modalCallback = onContinue;
                if (preflightModal) preflightModal.style.display = 'flex';
            });
        }

        function finalizeFull(success, uploadedFile) {
            fullRunning = false;
            if (startBtn) startBtn.disabled = false;
            if (success) {
                fullFinished = true;
                if (startBtn) startBtn.textContent = 'Finish';
                var importDetail = 'Uploaded ' + (uploadedFile || fileName) + ' to /Impex/' + cfg.impexPath + '/. Import tax tables in Business Manager.';
                setPhase('full', 'import', 'active', importDetail, null);
            } else {
                fullFinished = false;
                if (startBtn) startBtn.textContent = 'Start Migration (Build XML)';
            }
        }

        function beginMigration() {
            if (!overview || !overview.rateCount) {
                if (startBtn) startBtn.disabled = false;
                return;
            }

            fullRunning = true;
            if (startBtn) {
                startBtn.disabled = true;
                startBtn.textContent = 'Building...';
            }
            if (fullPhaseList) fullPhaseList.style.display = 'block';
            setPhase('full', 'build', 'active', 'Building tax table XML...', 50);
            setPhase('full', 'import', 'pending', null, 0);

            post(
                cfg.fullBatchUrl,
                'offset=0'
                + '&exportKey=full'
                + '&scopeType=full'
                + '&scopeId='
                + '&fileName=' + encodeURIComponent(fileName),
                function (data) {
                    if (!data.ok) {
                        setPhase('full', 'build', 'error', data.error || 'Failed', 50);
                        if (fullOverallEl) fullOverallEl.textContent = data.error || 'Build failed';
                        finalizeFull(false);
                        return;
                    }
                    var uploaded = data.fileName || fileName;
                    setPhase('full', 'build', 'done',
                        'Uploaded ' + uploaded + ' (' + (data.total || 0) + ' rate(s))', 100);
                    if (fullOverallEl) {
                        fullOverallEl.textContent = (data.built || 0) + ' element(s) written, ' + (data.failed || 0) + ' failed';
                    }
                    finalizeFull(true, uploaded);
                }
            );
        }

        if (reloadBtn) {
            reloadBtn.addEventListener('click', function () {
                loadOverview(true);
            });
        }

        if (loadingEl) {
            loadingEl.style.display = 'block';
            loadingEl.textContent = ui.loadTaxHint || 'Click Load to fetch tax classes and rates.';
        }
        if (overviewWrap) overviewWrap.style.display = 'none';

        if (checkAttrsBtn) {
            checkAttrsBtn.addEventListener('click', function () {
                checkAttrsBtn.disabled = true;
                checkAttrsBtn.textContent = ui.attrCheckingBtn || 'Checking...';
                if (attrCheckMsg) attrCheckMsg.textContent = '';
                get(cfg.checkAttrsUrl, function (data) {
                    checkAttrsBtn.disabled = false;
                    checkAttrsBtn.textContent = ui.attrRecheckBtn || 'Re-check';
                    if (!data.ok) {
                        if (attrCheckMsg) {
                            attrCheckMsg.textContent = 'Error: ' + (data.error || 'Check failed');
                            attrCheckMsg.style.color = '#c62828';
                        }
                        return;
                    }
                    pendingMissing = data.missing || [];
                    if (attrCheckMsg) {
                        attrCheckMsg.textContent = pendingMissing.length
                            ? pendingMissing.length + (ui.attrsMissingBrief || ' missing.')
                            : (ui.attrsAllInSync || 'All in sync.');
                        attrCheckMsg.style.color = pendingMissing.length ? '#e65100' : '#2e7d32';
                    }
                    renderAttrResults(pendingMissing);
                });
            });
        }

        if (modalSkipBtn) {
            modalSkipBtn.addEventListener('click', function () {
                if (preflightModal) preflightModal.style.display = 'none';
                if (modalCallback) modalCallback();
            });
        }

        if (modalCreateBtn) {
            modalCreateBtn.addEventListener('click', function () {
                modalCreateBtn.disabled = true;
                get(cfg.checkAttrsUrl, function (checkData) {
                    var missing = (checkData && checkData.missing) ? checkData.missing : [];
                    post(cfg.createAttrsUrl, 'attrs=' + encodeURIComponent(JSON.stringify(missing)), function (data) {
                        modalCreateBtn.disabled = false;
                        if (!data.ok) return;
                        if (preflightModal) preflightModal.style.display = 'none';
                        if (modalCallback) modalCallback();
                    });
                });
            });
        }

        if (startBtn) {
            startBtn.addEventListener('click', function () {
                if (fullFinished) {
                    window.location.href = cfg.dataWizardEntryUrl;
                    return;
                }
                if (fullRunning) return;
                fullFinished = false;
                startBtn.disabled = true;
                startBtn.textContent = ui.checkingAttrs || 'Checking attributes...';
                runPreflightThenMigrate(beginMigration);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
}());
