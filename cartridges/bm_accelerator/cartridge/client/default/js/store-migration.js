/**
 * Store migration — selectable CTP /stores export to SFCC IMPEX.
 */
(function () {
    'use strict';

    function readCfg() {
        var root = document.getElementById('acc-st-root');
        if (!root) return {};
        return {
            fullBatchUrl:       root.getAttribute('data-full-batch-url') || '',
            listStoresUrl:      root.getAttribute('data-list-stores-url') || '',
            checkAttrsUrl:      root.getAttribute('data-check-attrs-url') || '',
            createAttrsUrl:     root.getAttribute('data-create-attrs-url') || '',
            dataWizardEntryUrl: root.getAttribute('data-wizard-entry-url') || '',
            impexPath:          root.getAttribute('data-impex-path') || ''
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
        return 'store-full-' + todayStamp() + '-v001.xml';
    }

    function boot() {
        var cfg = readCfg();
        var loadingEl = document.getElementById('acc-st-loading');
        var errorEl = document.getElementById('acc-st-error');
        var tableWrap = document.getElementById('acc-st-table-wrap');
        var tbody = document.getElementById('acc-st-tbody');
        var summaryEl = document.getElementById('acc-st-summary');
        var selectAll = document.getElementById('acc-st-select-all');
        var selectionErr = document.getElementById('acc-st-selection-error');
        var fileWrap = document.getElementById('acc-st-file-wrap');
        var fileNameEl = document.getElementById('acc-st-file-name');
        var reloadBtn = document.getElementById('acc-reload-stores-btn');
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

        var ctpStores = [];
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

        function getSelectedStoreRefs() {
            var refs = [];
            var cbs = document.querySelectorAll('.acc-st-store-cb');
            var i;
            for (i = 0; i < cbs.length; i++) {
                if (cbs[i].checked) {
                    refs.push(cbs[i].getAttribute('data-ref'));
                }
            }
            return refs;
        }

        function updateSelectionSummary() {
            var checked = getSelectedStoreRefs().length;
            var total = ctpStores.length;
            if (summaryEl) {
                summaryEl.textContent = total
                    ? checked + ' of ' + total + ' selected for migration'
                    : '';
                summaryEl.style.color = checked ? '#2e7d32' : '#e65100';
            }
            if (startBtn && total && !fullRunning && !fullFinished) {
                startBtn.disabled = !checked;
            }
        }

        function renderStoresTable(stores) {
            ctpStores = stores || [];
            if (loadingEl) loadingEl.style.display = 'none';
            if (errorEl) errorEl.style.display = 'none';
            if (selectionErr) selectionErr.style.display = 'none';

            if (!ctpStores.length) {
                if (errorEl) {
                    errorEl.style.display = 'block';
                    errorEl.textContent = 'No stores found in commercetools. Create stores in CTP Merchant Center.';
                }
                if (tableWrap) tableWrap.style.display = 'none';
                if (fileWrap) fileWrap.style.display = 'none';
                if (startBtn) startBtn.disabled = true;
                updateSelectionSummary();
                return;
            }

            var html = '';
            var i;
            for (i = 0; i < ctpStores.length; i++) {
                var s = ctpStores[i];
                html += '<tr class="st-stores-row" data-idx="' + i + '">'
                    + '<td style="text-align:center;"><input type="checkbox" class="acc-st-store-cb" data-ref="'
                    + escHtml(s.ref) + '" data-idx="' + i + '" checked/></td>'
                    + '<td>' + escHtml(s.name) + '</td>'
                    + '<td>' + (s.key ? '<code>' + escHtml(s.key) + '</code>' : '<span style="color:#8a9ab8;">&mdash;</span>') + '</td>'
                    + '<td><code>' + escHtml(s.sfccStoreId) + '</code></td>'
                    + '<td style="font-size:12px;color:#54698d;">' + (s.countries ? escHtml(s.countries) : '&mdash;') + '</td>'
                    + '</tr>';
            }

            if (tbody) tbody.innerHTML = html;
            if (tableWrap) tableWrap.style.display = 'block';
            if (fileWrap) fileWrap.style.display = 'block';
            if (fileNameEl) fileNameEl.textContent = fileName;

            if (selectAll) {
                selectAll.checked = true;
                selectAll.onchange = function () {
                    var cbs = document.querySelectorAll('.acc-st-store-cb');
                    var c;
                    for (c = 0; c < cbs.length; c++) {
                        cbs[c].checked = selectAll.checked;
                        var row = cbs[c].closest('tr');
                        if (row) {
                            row.className = selectAll.checked ? 'st-stores-row' : 'st-stores-row st-stores-row--skipped';
                        }
                    }
                    updateSelectionSummary();
                };
            }

            var storeCbs = document.querySelectorAll('.acc-st-store-cb');
            for (i = 0; i < storeCbs.length; i++) {
                storeCbs[i].addEventListener('change', function () {
                    var row = this.closest('tr');
                    if (row) {
                        row.className = this.checked ? 'st-stores-row' : 'st-stores-row st-stores-row--skipped';
                    }
                    var all = document.querySelectorAll('.acc-st-store-cb');
                    var checkedCount = 0;
                    var a;
                    for (a = 0; a < all.length; a++) {
                        if (all[a].checked) checkedCount++;
                    }
                    if (selectAll) {
                        selectAll.checked = checkedCount === all.length;
                        selectAll.indeterminate = checkedCount > 0 && checkedCount < all.length;
                    }
                    updateSelectionSummary();
                });
            }

            updateSelectionSummary();
        }

        function loadStores(fromUserClick) {
            if (!cfg.listStoresUrl) {
                if (loadingEl) loadingEl.style.display = 'none';
                if (errorEl) {
                    errorEl.style.display = 'block';
                    errorEl.textContent = 'Store list API URL is missing. Hard-refresh the page (Ctrl+Shift+R).';
                }
                return;
            }

            if (loadingEl) {
                loadingEl.style.display = 'block';
                loadingEl.textContent = fromUserClick ? 'Reloading...' : 'Loading stores from commercetools...';
            }
            if (errorEl) errorEl.style.display = 'none';
            if (tableWrap) tableWrap.style.display = 'none';
            if (fileWrap) fileWrap.style.display = 'none';
            if (startBtn) startBtn.disabled = true;
            if (reloadBtn) {
                reloadBtn.disabled = true;
                reloadBtn.textContent = 'Loading...';
            }

            get(cfg.listStoresUrl, function (data) {
                if (reloadBtn) {
                    reloadBtn.disabled = false;
                    reloadBtn.textContent = 'Reload Stores';
                }
                if (!data.ok) {
                    if (loadingEl) loadingEl.style.display = 'none';
                    if (errorEl) {
                        errorEl.style.display = 'block';
                        errorEl.textContent = 'Failed to load: ' + (data.error || 'Unknown error');
                    }
                    ctpStores = [];
                    updateSelectionSummary();
                    return;
                }
                fileName = defaultFileName();
                renderStoresTable(data.stores || []);
            });
        }

        function renderAttrResults(missing) {
            if (!attrResults) return;
            attrResults.innerHTML = '';
            attrResults.style.display = 'block';
            if (!missing.length) {
                attrResults.innerHTML = '<p style="color:#2e7d32;font-size:13px;margin:0;">All CTP store attributes already exist in SFCC.</p>';
                return;
            }
            if (!window.AccAttrPreflight) {
                attrResults.innerHTML = '<p style="color:#c62828;font-size:13px;margin:0;">Attribute helper script failed to load.</p>';
                return;
            }
            var html = '<p style="font-size:13px;color:#54698d;margin:0 0 10px;">' + missing.length + ' attribute(s) missing in SFCC:</p>';
            html += '<div style="border:1px solid #e0e5ee;border-radius:4px;overflow:hidden;"><table class="cm-attr-table"><thead><tr>'
                + '<th style="width:36px;"><input type="checkbox" id="acc-attr-select-all" checked/></th>'
                + '<th>Attribute ID</th><th>Label</th><th>CTP Type</th><th>SFCC Type</th></tr></thead><tbody>';
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
                        + data.missing.length + ' attribute(s) missing.</p>';
                }
                modalCallback = onContinue;
                if (preflightModal) preflightModal.style.display = 'flex';
            });
        }

        function finalizeFull(success, uploadedFile) {
            fullRunning = false;
            if (success) {
                fullFinished = true;
                if (startBtn) {
                    startBtn.textContent = 'Finish';
                    startBtn.disabled = false;
                }
                var importDetail = 'Uploaded ' + (uploadedFile || fileName) + ' to /Impex/' + cfg.impexPath + '/. Import stores in Business Manager.';
                setPhase('full', 'import', 'active', importDetail, null);
            } else {
                fullFinished = false;
                if (startBtn) startBtn.textContent = 'Start Migration (Build XML)';
                updateSelectionSummary();
            }
        }

        function beginMigration() {
            var keys = getSelectedStoreRefs();
            if (!keys.length) {
                if (selectionErr) {
                    selectionErr.style.display = 'block';
                    selectionErr.textContent = 'Select at least one store to migrate.';
                }
                if (startBtn) startBtn.disabled = false;
                return;
            }
            if (selectionErr) selectionErr.style.display = 'none';

            fullRunning = true;
            if (startBtn) {
                startBtn.disabled = true;
                startBtn.textContent = 'Building...';
            }
            if (fullPhaseList) fullPhaseList.style.display = 'block';
            setPhase('full', 'build', 'active', 'Building store XML for ' + keys.length + ' store(s)...', 50);
            setPhase('full', 'import', 'pending', null, 0);

            post(
                cfg.fullBatchUrl,
                'offset=0'
                + '&exportKey=full'
                + '&fileName=' + encodeURIComponent(fileName)
                + '&keys=' + encodeURIComponent(JSON.stringify(keys)),
                function (data) {
                    if (!data.ok) {
                        setPhase('full', 'build', 'error', data.error || 'Failed', 50);
                        if (fullOverallEl) fullOverallEl.textContent = data.error || 'Build failed';
                        finalizeFull(false);
                        return;
                    }
                    var uploaded = data.fileName || fileName;
                    setPhase('full', 'build', 'done',
                        'Uploaded ' + uploaded + ' (' + (data.total || 0) + ' store(s))', 100);
                    if (fullOverallEl) {
                        fullOverallEl.textContent = (data.built || 0) + ' element(s) written, ' + (data.failed || 0) + ' failed';
                    }
                    finalizeFull(true, uploaded);
                }
            );
        }

        if (reloadBtn) {
            reloadBtn.addEventListener('click', function () {
                loadStores(true);
            });
        }

        if (loadingEl) {
            loadingEl.style.display = 'block';
            loadingEl.textContent = 'Click Load Stores to fetch stores from commercetools.';
        }
        if (tableWrap) tableWrap.style.display = 'none';
        if (fileWrap) fileWrap.style.display = 'none';

        if (checkAttrsBtn) {
            checkAttrsBtn.addEventListener('click', function () {
                checkAttrsBtn.disabled = true;
                checkAttrsBtn.textContent = 'Checking...';
                if (attrCheckMsg) attrCheckMsg.textContent = '';
                get(cfg.checkAttrsUrl, function (data) {
                    checkAttrsBtn.disabled = false;
                    checkAttrsBtn.textContent = 'Re-check';
                    if (!data.ok) {
                        if (attrCheckMsg) {
                            attrCheckMsg.textContent = 'Error: ' + (data.error || 'Check failed');
                            attrCheckMsg.style.color = '#c62828';
                        }
                        return;
                    }
                    pendingMissing = data.missing || [];
                    if (attrCheckMsg) {
                        attrCheckMsg.textContent = pendingMissing.length ? pendingMissing.length + ' missing.' : 'All in sync.';
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
                startBtn.textContent = 'Checking attributes...';
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
