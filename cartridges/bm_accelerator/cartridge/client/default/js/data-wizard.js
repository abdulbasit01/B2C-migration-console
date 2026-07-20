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
            selectTypeUrl: cfgVal('acc-dw-select-type-url'),
            msgs: {
                connectionFailed: cfgVal('acc-dw-msg-connection-failed'),
                connectionSuccess: cfgVal('acc-dw-msg-connection-success'),
                selectTypeNoneSelected: cfgVal('acc-dw-msg-select-none')
            }
        };

        if (!cfg.step || cfg.step === 'connect') return;

        if (cfg.step === 'selectType') {
            initSelectType(cfg);
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
                var typeForm  = document.getElementById('acc-data-type-form');
                var typeInput = document.getElementById('acc-selected-type');
                if (typeForm && typeInput) {
                    typeInput.value = selected;
                    typeForm.submit();
                    return;
                }
                var selectTypeUrl = cfg.selectTypeUrl || cfgVal('acc-dw-select-type-url');
                if (selectTypeUrl) {
                    var sep = selectTypeUrl.indexOf('?') >= 0 ? '&' : '?';
                    window.location.href = selectTypeUrl + sep + 'type=' + encodeURIComponent(selected);
                    return;
                }
                var stepThreeBase = cfgVal('acc-dw-step-three-base');
                var nextUrl = stepThreeBase
                    ? stepThreeBase + String.fromCharCode(38) + 'type=' + encodeURIComponent(selected)
                    : cfg.wizardBaseUrl + String.fromCharCode(38) + 'step=3' + String.fromCharCode(38) + 'type=' + encodeURIComponent(selected);
                window.location.href = nextUrl;
            });
        }

        syncPanelStates();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
}());
