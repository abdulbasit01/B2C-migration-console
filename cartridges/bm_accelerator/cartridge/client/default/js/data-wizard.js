(function () {
    function cfgVal(id) {
        var el = document.getElementById(id);
        return el ? el.value : '';
    }

    function postForm(url, params, onDone) {
        var req = new XMLHttpRequest();
        req.open('POST', url, true);
        req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.onreadystatechange = function () {
            if (req.readyState !== 4) return;
            var data;
            try { data = JSON.parse(req.responseText); } catch (e) { data = { ok: false, error: 'Invalid response' }; }
            onDone(data);
        };
        req.send(params);
    }

    function findPanel(el) {
        if (el && el.closest) return el.closest('.acc-panel');
        while (el) {
            if (el.className && el.className.indexOf('acc-panel') >= 0) return el;
            el = el.parentNode;
        }
        return null;
    }

    function boot() {
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
                selectTypeNoneSelected: cfgVal('acc-dw-msg-select-none'),
                exportRunning: cfgVal('acc-dw-msg-export-running'),
                exportFailed: cfgVal('acc-dw-msg-export-failed'),
                exportComplete: cfgVal('acc-dw-msg-export-complete')
            }
        };

        if (!cfg.step || cfg.step === 'connect') return;

        if (cfg.step === 'selectType') {
            initSelectType(cfg);
        } else if (cfg.step === 'orderConfigure') {
            initOrderConfigure();
        } else if (cfg.step === 'orderExport') {
            initOrderExport(cfg, postForm);
        }
    }

    function initSelectType(cfg) {
        var msgs = cfg.msgs || {};
        var continueBtn = document.getElementById('data-type-continue');
        var panels      = document.querySelectorAll('#acc-data-type-panels .acc-panel--selectable');

        function getRadios() {
            return document.querySelectorAll('.acc-data-type-radio');
        }

        function getSelected() {
            var radios = getRadios();
            var ri = 0;
            var radioCount = radios.length;
            while (radioCount > ri) {
                if (radios[ri].checked) {
                    return radios[ri].getAttribute('data-type-id');
                }
                ri += 1;
            }
            return '';
        }

        function syncPanelStates() {
            var radios = getRadios();
            var ri = 0;
            var radioCount = radios.length;
            while (radioCount > ri) {
                syncPanelState(radios[ri]);
                ri += 1;
            }
        }

        function syncPanelState(radio) {
            var panel = findPanel(radio);
            if (!panel) return;
            if (radio.checked) {
                panel.className = panel.className.replace(' acc-panel--unchecked', '');
            } else if (panel.className.indexOf('acc-panel--unchecked') === -1) {
                panel.className += ' acc-panel--unchecked';
            }
        }

        var radios = getRadios();
        var ri = 0;
        var radioCount = radios.length;
        while (radioCount > ri) {
            (function (radio) {
                radio.addEventListener('change', function () {
                    syncPanelStates();
                });
            }(radios[ri]));
            ri += 1;
        }

        var pi = 0;
        var panelCount = panels.length;
        while (panelCount > pi) {
            (function (panel) {
                panel.addEventListener('click', function (e) {
                    if (e.target && e.target.className && e.target.className.indexOf('acc-data-type-radio') >= 0) return;
                    var radio = panel.querySelector('.acc-data-type-radio');
                    if (radio) {
                        radio.checked = true;
                        syncPanelStates();
                    }
                });
            }(panels[pi]));
            pi += 1;
        }

        if (continueBtn) {
            continueBtn.addEventListener('click', function (e) {
                e.preventDefault();
                var selected = getSelected();
                if (!selected) {
                    alert(msgs.selectTypeNoneSelected || 'Please select a data type.');
                    return;
                }
                window.location.href = cfg.wizardBaseUrl + '&step=3&type=' + encodeURIComponent(selected);
            });
        }

        syncPanelStates();
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
                    labels[li].className = labels[li].className.replace(' acc-chip--selected', '');
                    li += 1;
                }
                if (this.parentNode) {
                    var cn = this.parentNode.className || '';
                    if (cn.indexOf('acc-chip--selected') === -1) {
                        this.parentNode.className = cn + ' acc-chip--selected';
                    }
                }
            });
            ci += 1;
        }
    }

    function initOrderExport(cfg, post) {
        var msgs = cfg.msgs || {};
        var exportBtn  = document.getElementById('order-export-btn');
        var reviewLink = document.getElementById('order-review-link');
        var statusBox  = document.getElementById('order-export-status');
        var phaseIds   = cfg.exportPhaseIds || [];

        if (!exportBtn || !statusBox) return;

        function showStatus(msg, type) {
            statusBox.textContent = msg;
            statusBox.className = 'acc-callout acc-callout--' + (type || 'info');
            statusBox.className = statusBox.className.replace(' acc-hidden', '');
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
            if (reviewLink) reviewLink.className += ' acc-hidden';
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

            post(cfg.exportUrl, body, function (data) {
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
                if (reviewLink) {
                    reviewLink.className = reviewLink.className.replace(' acc-hidden', '');
                    reviewLink.href = reviewUrl;
                }
                maybeFinish();
                window.location.href = reviewUrl;
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
}());
