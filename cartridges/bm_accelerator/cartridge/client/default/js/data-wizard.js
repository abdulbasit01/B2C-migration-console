/* global fetch */
(function () {
    function cfgVal(id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    }

    var cfg = {
        step: cfgVal('acc-dw-step'),
        testConnectionUrl: cfgVal('acc-dw-test-url'),
        wizardBaseUrl: cfgVal('acc-dw-wizard-base'),
        exportUrl: cfgVal('acc-dw-export-url'),
        orderYears: cfgVal('acc-dw-order-years') || '1',
        orderMaxCount: cfgVal('acc-dw-order-max-count') || '',
        exportPhaseIds: cfgVal('acc-dw-export-phases').split(',').filter(Boolean),
        msgs: {
            connectionFailed: cfgVal('acc-dw-msg-connection-failed'),
            connectionSuccess: cfgVal('acc-dw-msg-connection-success'),
            selectTypeCountSuffix: cfgVal('acc-dw-msg-select-count'),
            selectTypeNoneSelected: cfgVal('acc-dw-msg-select-none'),
            exportRunning: cfgVal('acc-dw-msg-export-running'),
            exportFailed: cfgVal('acc-dw-msg-export-failed'),
            exportComplete: cfgVal('acc-dw-msg-export-complete')
        }
    };

    if (!cfg.step) return;

    if (cfg.step === 'connect') {
        initConnect(cfg);
    } else if (cfg.step === 'selectType') {
        initSelectType(cfg);
    } else if (cfg.step === 'orderConfigure') {
        initOrderConfigure();
    } else if (cfg.step === 'orderExport') {
        initOrderExport(cfg);
    }

    function initConnect(cfg) {
        var testBtn      = document.getElementById('data-test-connection-btn');
        var statusEl     = document.getElementById('data-connection-status');
        var form         = document.getElementById('acc-data-connect-form');
        var continueWrap = document.getElementById('data-wizard-continue-wrap');
        var continueBtn  = document.getElementById('data-wizard-continue');
        var msgs         = cfg.msgs || {};

        if (!testBtn || !form || !continueWrap || !continueBtn) return;

        function showStatus(msg, isError) {
            statusEl.textContent = msg;
            statusEl.className = 'acc-status' + (isError ? ' acc-status--error' : ' acc-status--success');
            statusEl.classList.remove('acc-status--hidden');
        }

        function setContinueEnabled(enabled) {
            continueBtn.disabled = !enabled;
            if (enabled) {
                continueWrap.classList.remove('acc-hidden');
            } else {
                continueWrap.classList.add('acc-hidden');
            }
        }

        testBtn.addEventListener('click', function () {
            testBtn.disabled = true;
            showStatus('Testing connection...', false);
            setContinueEnabled(false);

            var fields = form.querySelectorAll('input[name]');
            var body   = ['mode=data'];
            var fi = 0;
            var fieldCount = fields.length;
            while (fieldCount > fi) {
                var f = fields[fi];
                body.push(encodeURIComponent(f.name) + '=' + encodeURIComponent(f.value || ''));
                fi += 1;
            }

            fetch(cfg.testConnectionUrl, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.join('&')
            })
                .then(function (res) { return res.json(); })
                .then(function (data) {
                    testBtn.disabled = false;
                    if (!data.ok) {
                        showStatus((msgs.connectionFailed || 'Connection failed') + ': ' + (data.error || 'Unknown error'), true);
                        return;
                    }
                    var projectName = data.project && data.project.name
                        ? data.project.name
                        : (data.project && data.project.key ? data.project.key : '');
                    showStatus((msgs.connectionSuccess || 'Connection successful.') + (projectName ? ' - ' + projectName : ''), false);
                    setContinueEnabled(true);
                })
                .catch(function (err) {
                    testBtn.disabled = false;
                    showStatus((msgs.connectionFailed || 'Connection failed') + ': ' + err.message, true);
                });
        });
    }

    function initSelectType(cfg) {
        var msgs = cfg.msgs || {};
        var nextUrl = cfg.wizardBaseUrl + '&step=3';

        function run() {
            var continueBtn    = document.getElementById('data-type-continue');
            var selectAllBtn   = document.getElementById('acc-data-select-all');
            var deselectAllBtn = document.getElementById('acc-data-deselect-all');
            var countEl        = document.getElementById('acc-data-selection-count');

            function getBoxes() {
                return document.querySelectorAll('.acc-data-type-checkbox');
            }

            function getChecked() {
                var boxes = getBoxes();
                var ids   = [];
                var bi = 0;
                var boxCount = boxes.length;
                while (boxCount > bi) {
                    if (boxes[bi].checked) ids.push(boxes[bi].getAttribute('data-type-id'));
                    bi += 1;
                }
                return ids;
            }

            function syncPanelState(cb) {
                var panel = cb.closest ? cb.closest('.acc-panel') : null;
                if (!panel) {
                    var el = cb.parentNode;
                    while (el && el.className && el.className.indexOf('acc-panel') === -1) el = el.parentNode;
                    panel = el;
                }
                if (panel) {
                    if (cb.checked) {
                        panel.className = panel.className.replace(' acc-panel--unchecked', '');
                    } else if (panel.className.indexOf('acc-panel--unchecked') === -1) {
                        panel.className += ' acc-panel--unchecked';
                    }
                }
            }

            function updateCount() {
                var ids = getChecked();
                countEl.textContent = ids.length + ' ' + (msgs.selectTypeCountSuffix || 'selected');
            }

            // Radio-style: selecting one type unchecks all others.
            function selectOnly(chosen) {
                var cbs = getBoxes();
                var ci = 0;
                var cbCount = cbs.length;
                while (cbCount > ci) {
                    cbs[ci].checked = (cbs[ci] === chosen);
                    syncPanelState(cbs[ci]);
                    ci += 1;
                }
                updateCount();
            }

            // On page load: keep only the first checkbox checked.
            var initBoxes = getBoxes();
            var firstChecked = false;
            var ibi = 0;
            while (ibi < initBoxes.length) {
                if (!firstChecked && initBoxes[ibi].checked) {
                    firstChecked = true;
                } else {
                    initBoxes[ibi].checked = false;
                }
                syncPanelState(initBoxes[ibi]);
                ibi += 1;
            }

            var boxes = getBoxes();
            var bi = 0;
            var boxCount = boxes.length;
            while (boxCount > bi) {
                (function (cb) {
                    cb.addEventListener('change', function () {
                        if (cb.checked) {
                            selectOnly(cb);
                        } else {
                            syncPanelState(cb);
                            updateCount();
                        }
                    });
                }(boxes[bi]));
                bi += 1;
            }

            // Also select on panel click (anywhere on the card)
            var panels = document.querySelectorAll('#acc-data-type-panels .acc-panel--selectable');
            var pi = 0;
            while (pi < panels.length) {
                (function (panel) {
                    panel.addEventListener('click', function () {
                        var cb = panel.querySelector('.acc-data-type-checkbox');
                        if (cb) { selectOnly(cb); cb.checked = true; }
                    });
                }(panels[pi]));
                pi += 1;
            }

            if (deselectAllBtn) {
                deselectAllBtn.addEventListener('click', function () {
                    var cbs = getBoxes();
                    var ci = 0;
                    var cbCount = cbs.length;
                    while (cbCount > ci) {
                        cbs[ci].checked = false;
                        syncPanelState(cbs[ci]);
                        ci += 1;
                    }
                    updateCount();
                });
            }

            if (continueBtn) {
                continueBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    var selected = getChecked();
                    if (!selected.length) {
                        alert(msgs.selectTypeNoneSelected || 'Please select a data type.');
                        return;
                    }
                    window.location.href = nextUrl + '&type=' + encodeURIComponent(selected[0]);
                });
            }

            updateCount();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run);
        } else {
            run();
        }
    }

    function initOrderConfigure() {
        var chips = document.querySelectorAll('.acc-chip input[type="radio"]');
        var ci = 0;
        var chipCount = chips.length;
        while (chipCount > ci) {
            chips[ci].addEventListener('change', function () {
                var labels = document.querySelectorAll('.acc-chip');
                var li = 0;
                var labelCount = labels.length;
                while (labelCount > li) {
                    labels[li].classList.remove('acc-chip--selected');
                    li += 1;
                }
                if (this.parentNode) this.parentNode.classList.add('acc-chip--selected');
            });
            ci += 1;
        }
    }

    function initOrderExport(cfg) {
        var msgs = cfg.msgs || {};
        var exportBtn  = document.getElementById('order-export-btn');
        var reviewLink = document.getElementById('order-review-link');
        var statusBox  = document.getElementById('order-export-status');
        var phaseIds   = cfg.exportPhaseIds || [];

        if (!exportBtn) return;

        function showStatus(msg, type) {
            statusBox.textContent = msg;
            statusBox.className = 'acc-callout acc-callout--' + (type || 'info');
            statusBox.classList.remove('acc-hidden');
        }

        function setPhase(id, state, pct) {
            var li     = document.getElementById('order-phase-' + id);
            var status = document.getElementById('order-status-' + id);
            var bar    = document.getElementById('order-bar-' + id);
            if (!li) return;
            li.className = 'acc-phases__item acc-phases__item--' + state;
            if (status) status.textContent = state;
            if (bar) bar.style.width = (pct || 0) + '%';
        }

        function animatePhases(onComplete) {
            var idx = 0;
            function next() {
                if (idx >= phaseIds.length) {
                    if (onComplete) onComplete();
                    return;
                }
                var id = phaseIds[idx];
                setPhase(id, 'active', 35);
                setTimeout(function () {
                    setPhase(id, 'done', 100);
                    idx += 1;
                    next();
                }, 450);
            }
            var pi = 0;
            var phaseCount = phaseIds.length;
            while (phaseCount > pi) {
                setPhase(phaseIds[pi], 'pending', 0);
                pi += 1;
            }
            next();
        }

        exportBtn.addEventListener('click', function () {
            exportBtn.disabled = true;
            reviewLink.classList.add('acc-hidden');
            showStatus(msgs.exportRunning || 'Export in progress...', 'info');

            var body = 'years=' + encodeURIComponent(cfg.orderYears || '1');
            if (cfg.orderMaxCount) body += '&maxCount=' + encodeURIComponent(cfg.orderMaxCount);

            var exportDone = false;
            var animDone   = false;
            var reviewUrl  = cfg.wizardBaseUrl + '&step=5';

            function maybeFinish() {
                if (exportDone && animDone) {
                    exportBtn.disabled = false;
                }
            }

            animatePhases(function () { animDone = true; maybeFinish(); });

            fetch(cfg.exportUrl, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body
            })
                .then(function (res) { return res.json(); })
                .then(function (data) {
                    exportDone = true;
                    if (!data.ok) {
                        showStatus((msgs.exportFailed || 'Export failed') + ': ' + (data.error || 'Unknown error'), 'error');
                        var ei = 0;
                        var errCount = phaseIds.length;
                        while (errCount > ei) {
                            setPhase(phaseIds[ei], 'error', 0);
                            ei += 1;
                        }
                        exportBtn.disabled = false;
                        return;
                    }
                    showStatus(msgs.exportComplete || 'Export complete.', 'success');
                    reviewLink.classList.remove('acc-hidden');
                    reviewLink.href = reviewUrl;
                    maybeFinish();
                    window.location.href = reviewUrl;
                })
                .catch(function (err) {
                    exportDone = true;
                    showStatus((msgs.exportFailed || 'Export failed') + ': ' + err.message, 'error');
                    exportBtn.disabled = false;
                });
        });
    }
}());
