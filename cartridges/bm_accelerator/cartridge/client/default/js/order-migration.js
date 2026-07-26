/**
 * Order migration — filter, count, and stream one SFCC order XML to IMPEX.
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
        var root = document.getElementById('acc-ord-root');
        if (!root) return { ui: {} };
        return {
            countUrl:           root.getAttribute('data-count-url') || '',
            exportUrl:          root.getAttribute('data-export-url') || '',
            checkAttrsUrl:      root.getAttribute('data-check-attrs-url') || '',
            createAttrsUrl:     root.getAttribute('data-create-attrs-url') || '',
            clearAttrMapUrl:    root.getAttribute('data-clear-attr-map-url') || '',
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

    function fmtNum(n) {
        return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
            var data;
            try { data = JSON.parse(req.responseText); } catch (e) { data = { ok: false, error: 'Parse error' }; }
            onDone(data);
        };
        req.onerror = function () { onDone({ ok: false, error: 'Network error' }); };
        req.send(params);
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
            var data;
            try { data = JSON.parse(req.responseText); } catch (e) { data = { ok: false, error: 'Parse error' }; }
            onDone(data);
        };
        req.onerror = function () { onDone({ ok: false, error: 'Network error' }); };
        req.send(null);
    }

    function boot() {
        var cfg = readCfg();
        var ui  = cfg.ui || {};
        if (window.AccAttrPreflight && window.AccAttrPreflight.bindClearOnLeave) {
            window.AccAttrPreflight.bindClearOnLeave(cfg.clearAttrMapUrl, 'Accelerator-OrderMigration');
        }
        var yearsEl       = document.getElementById('acc-ord-years');
        var stateEl       = document.getElementById('acc-ord-order-state');
        var payEl         = document.getElementById('acc-ord-payment-state');
        var maxEl         = document.getElementById('acc-ord-max-count');
        var countBtn      = document.getElementById('acc-ord-count-btn');
        var countValueEl  = document.getElementById('acc-ord-count-value');
        var countExportEl = document.getElementById('acc-ord-count-export');
        var startBtn      = document.getElementById('full-start-btn');
        var fullPhaseList = document.getElementById('full-phase-list');
        var fullOverallEl = document.getElementById('full-move-overall');
        var checkAttrsBtn = document.getElementById('acc-check-attrs-btn');
        var attrCheckMsg  = document.getElementById('acc-attr-check-msg');
        var attrResults   = document.getElementById('acc-attr-results');
        var preflightModal = document.getElementById('acc-preflight-modal');
        var modalAttrList  = document.getElementById('acc-modal-attr-list');
        var modalSkipBtn   = document.getElementById('acc-modal-skip');
        var modalCreateBtn = document.getElementById('acc-modal-create');

        var pendingMissing = [];
        var modalCallback  = null;
        var fullRunning    = false;
        var lastCount      = 0;

        function setPhase(prefix, id, state, detail, pct) {
            var li  = document.getElementById(prefix + '-phase-' + id);
            var st  = document.getElementById(prefix + '-status-' + id);
            var det = document.getElementById(prefix + '-detail-' + id);
            var bar = document.getElementById(prefix + '-bar-' + id);
            if (!li) return;
            li.className = 'acc-phases__item acc-phases__item--' + state;
            if (st)  st.textContent = state;
            if (det && detail !== null) det.textContent = detail || '';
            if (bar && pct !== null && pct !== undefined) bar.style.width = pct + '%';
        }

        function getFilterParams() {
            var years = yearsEl ? yearsEl.value : '1';
            var body  = 'years=' + encodeURIComponent(years);
            if (stateEl && stateEl.value) body += '&orderState=' + encodeURIComponent(stateEl.value);
            if (payEl && payEl.value) body += '&paymentState=' + encodeURIComponent(payEl.value);
            if (maxEl && maxEl.value) body += '&maxCount=' + encodeURIComponent(maxEl.value);
            return body;
        }

        function showCountIdle() {
            if (!countValueEl) return;
            countValueEl.textContent = 'Set your filters, then check how many orders match.';
            countValueEl.className = 'acc-order-count__value acc-order-count__value--idle';
            if (countExportEl) countExportEl.style.display = 'none';
            lastCount = 0;
            if (startBtn) startBtn.disabled = true;
        }

        function showCountLoading() {
            if (!countValueEl) return;
            countValueEl.textContent = ui.orderCountChecking || 'Checking...';
            countValueEl.className = 'acc-order-count__value acc-order-count__value--loading';
            if (countExportEl) countExportEl.style.display = 'none';
        }

        function showCountResult(data) {
            if (!countValueEl) return;
            var total       = data.total || 0;
            var exportCount = data.exportCount != null ? data.exportCount : total;
            lastCount = exportCount;

            if (total === 0) {
                countValueEl.textContent = 'No orders match your filters.';
                countValueEl.className = 'acc-order-count__value';
                if (startBtn) startBtn.disabled = true;
                return;
            }

            countValueEl.textContent = fmtNum(total) + ' orders match your filters';
            countValueEl.className = 'acc-order-count__value';

            if (maxEl && maxEl.value && exportCount < total && countExportEl) {
                countExportEl.textContent = fmtNum(exportCount) + ' orders will be exported (max count applied)';
                countExportEl.style.display = 'block';
            } else if (countExportEl) {
                countExportEl.style.display = 'none';
            }

            if (startBtn) startBtn.disabled = exportCount === 0;
        }

        function fetchOrderCount() {
            if (!cfg.countUrl) return;
            showCountLoading();
            if (countBtn) countBtn.disabled = true;
            post(cfg.countUrl, getFilterParams(), function (data) {
                if (countBtn) countBtn.disabled = false;
                if (!data.ok) {
                    if (countValueEl) {
                        countValueEl.textContent = 'Unable to count orders' + (data.error ? ': ' + data.error : '');
                        countValueEl.className = 'acc-order-count__value';
                    }
                    return;
                }
                showCountResult(data);
            });
        }

        function renderAttrResults(missing) {
            if (!attrResults) return;
            if (!window.AccAttrPreflight || !window.AccAttrPreflight.renderMissingResults) {
                attrResults.innerHTML = '<p style="color:#c62828;font-size:13px;margin:0;">Attribute helper script failed to load.</p>';
                attrResults.style.display = 'block';
                return;
            }
            window.AccAttrPreflight.renderMissingResults({
                container:      attrResults,
                missing:        missing,
                ui:             ui,
                createAttrsUrl: cfg.createAttrsUrl,
                post:           post,
                getPending:     function () { return pendingMissing; }
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
                if (startBtn) startBtn.textContent = 'Finish';
                var importDetail = (uploadedFile || 'Order XML') + ' is ready in IMPEX. Import via Site Development.';
                setPhase('full', 'import', 'active', importDetail, null);
            } else if (startBtn) {
                startBtn.textContent = 'Start Migration (Build XML)';
            }
        }

        function beginMigration() {
            if (!lastCount) {
                fetchOrderCount();
                return;
            }

            fullRunning = true;
            if (startBtn) {
                startBtn.disabled = true;
                startBtn.textContent = 'Building...';
            }
            if (fullPhaseList) fullPhaseList.style.display = 'block';
            setPhase('full', 'build', 'active', 'Streaming orders to IMPEX...', 25);
            setPhase('full', 'import', 'pending', 'Waiting for Phase 1…', 0);

            var body = getFilterParams() + '&singleFile=true&offset=0';
            post(cfg.exportUrl, body, function (data) {
                if (!data.ok) {
                    setPhase('full', 'build', 'error', data.error || 'Failed', 0);
                    if (fullOverallEl) fullOverallEl.textContent = data.error || 'Build failed';
                    finalizeFull(false);
                    return;
                }

                var report = data.report || {};
                var built  = report.ordersValidated || data.built || 0;
                var failed = report.ordersFailed || data.failed || 0;
                var buildState = 'done';
                if (failed > 0 && built === 0) buildState = 'error';
                else if (failed > 0) buildState = 'warning';

                var buildDetail = built + ' order(s) written';
                if (failed > 0) buildDetail += ', ' + failed + ' failed validation';
                if (data.fileName) buildDetail += ' — ' + data.fileName;

                setPhase('full', 'build', buildState, buildDetail, 100);
                if (fullOverallEl) {
                    fullOverallEl.textContent = built + ' validated, ' + failed + ' failed';
                }
                finalizeFull(true, data.fileName);
            });
        }

        if (yearsEl) yearsEl.addEventListener('change', showCountIdle);
        if (stateEl) stateEl.addEventListener('change', showCountIdle);
        if (payEl) payEl.addEventListener('change', showCountIdle);
        if (maxEl) maxEl.addEventListener('input', showCountIdle);

        if (countBtn) {
            countBtn.addEventListener('click', function (e) {
                e.preventDefault();
                fetchOrderCount();
            });
        }

        if (startBtn) {
            startBtn.disabled = true;
            startBtn.addEventListener('click', function () {
                if (fullRunning) return;
                if (startBtn.textContent === 'Finish') return;
                runPreflightThenMigrate(beginMigration);
            });
        }

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
                if (preflightModal) preflightModal.style.display = 'none';
                if (modalCallback) modalCallback();
            });
        }

        showCountIdle();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
}());
