'use strict';

/**
 * Amplience CMS content schema migration — connect, fetch types, map to SFCC.
 */
(function () {
    var connected = false;
    var typesLoaded = false;
    var currentStep = 1;
    var cachedTypes = [];

    /**
     * Read page config from data attributes.
     * @returns {Object} config values
     */
    function readCfg() {
        var root = document.getElementById('acc-cms-schema-root');
        if (!root) return {};
        return {
            platformId: root.getAttribute('data-platform-id') || 'amplience',
            testConnectionUrl: root.getAttribute('data-test-connection-url') || '',
            listTypesUrl: root.getAttribute('data-list-types-url') || ''
        };
    }

    /**
     * Escape text for HTML insertion.
     * @param {*} val - raw value
     * @returns {string} escaped string
     */
    function escHtml(val) {
        if (val === null || val === undefined) return '';
        return String(val)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Parse a JSON HTTP response body.
     * @param {string} raw - response text
     * @param {string} fallbackError - error when empty
     * @returns {Object} parsed payload
     */
    function parseJsonResponse(raw, fallbackError) {
        if (!raw || !String(raw).trim()) {
            return { ok: false, error: fallbackError || 'Empty response from server' };
        }
        try {
            return JSON.parse(raw);
        } catch (e) {
            return { ok: false, error: 'Server returned non-JSON response' };
        }
    }

    /**
     * POST form-encoded data.
     * @param {string} url - endpoint
     * @param {string} params - body
     * @param {Function} onDone - callback
     * @returns {void}
     */
    function post(url, params, onDone) {
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

    /**
     * GET JSON data.
     * @param {string} url - endpoint
     * @param {Function} onDone - callback
     * @returns {void}
     */
    function get(url, onDone) {
        var req = new XMLHttpRequest();
        req.open('GET', url, true);
        req.onreadystatechange = function () {
            if (req.readyState !== 4) return;
            onDone(parseJsonResponse(req.responseText, 'Parse error'));
        };
        req.onerror = function () { onDone({ ok: false, error: 'Network error' }); };
        req.send(null);
    }

    /**
     * Set status text and style on an element.
     * @param {HTMLElement} el - status node
     * @param {string} msg - message
     * @param {boolean} isError - error style when true
     * @returns {void}
     */
    function setStatus(el, msg, isError) {
        if (!el) return;
        var node = el;
        var className = 'cms-panel__status';
        if (isError) {
            className += ' cms-panel__status--error';
        } else if (msg) {
            className += ' cms-panel__status--ok';
        }
        node.textContent = msg || '';
        node.className = className;
    }

    /**
     * Update Previous/Continue footer for the active step.
     * @param {number} step - step number
     * @returns {void}
     */
    function updateFooter(step) {
        var prevBtn = document.getElementById('acc-cms-schema-prev');
        var nextBtn = document.getElementById('acc-cms-schema-next');
        if (prevBtn) {
            prevBtn.style.visibility = step > 1 ? 'visible' : 'hidden';
        }
        if (nextBtn) {
            if (step === 1) {
                nextBtn.style.display = '';
                nextBtn.disabled = !connected;
            } else if (step === 2) {
                nextBtn.style.display = '';
                nextBtn.disabled = !typesLoaded;
            } else {
                nextBtn.style.display = 'none';
            }
        }
    }

    /**
     * Show a wizard step panel.
     * @param {number} step - step number
     * @returns {void}
     */
    function showStep(step) {
        currentStep = step;
        var panels = [1, 2, 3];
        var pi = 0;
        while (pi < panels.length) {
            var panel = document.getElementById('cms-schema-panel-step' + panels[pi]);
            if (panel) panel.style.display = panels[pi] === step ? '' : 'none';
            var tab = document.getElementById('cms-schema-tab-' + panels[pi]);
            if (tab) {
                tab.className = 'cms-steps__tab' + (panels[pi] === step ? ' cms-steps__tab--active' : '');
                tab.disabled = panels[pi] > 1 && !connected;
            }
            pi += 1;
        }
        updateFooter(step);
    }

    /**
     * Render mapped content-type rows.
     * @param {Object[]} types - content types
     * @returns {void}
     */
    function renderTypeList(types) {
        var tbody = document.getElementById('acc-cms-schema-tbody');
        var wrap = document.getElementById('acc-cms-schema-table-wrap');
        var emptyEl = document.getElementById('acc-cms-schema-map-empty');
        var mapStatus = document.getElementById('acc-cms-schema-map-status');
        if (!tbody || !wrap) return;

        var html = '';
        var i = 0;
        while (i < types.length) {
            var item = types[i];
            html += '<tr>';
            html += '<td class="cms-col-label">' + escHtml(item.label) + '</td>';
            html += '<td class="cms-col-schema">' + escHtml(item.schemaShort || '—') + '</td>';
            html += '<td class="cms-col-sfcc"><code>' + escHtml(item.sfccComponentLabel || item.sfccComponent || '—') + '</code></td>';
            html += '<td class="cms-col-fields">' + escHtml(String(item.fieldCount != null ? item.fieldCount : '—')) + '</td>';
            html += '</tr>';
            i += 1;
        }

        tbody.innerHTML = html;
        wrap.style.display = types.length ? '' : 'none';
        if (emptyEl) emptyEl.style.display = types.length ? 'none' : '';
        if (mapStatus) mapStatus.textContent = types.length ? types.length + ' type(s) mapped' : '';
    }

    /**
     * Bind a step tab click handler.
     * @param {number} stepNum - step number
     * @returns {void}
     */
    function bindTab(stepNum) {
        var tab = document.getElementById('cms-schema-tab-' + stepNum);
        if (!tab) return;
        tab.addEventListener('click', function () {
            if (stepNum > 1 && !connected) return;
            if (stepNum === 3 && !typesLoaded) return;
            showStep(stepNum);
        });
    }

    /**
     * Initialize the schema migration page.
     * @returns {void}
     */
    function init() {
        var cfg = readCfg();
        var testBtn = document.getElementById('acc-cms-schema-test-btn');
        var prevBtn = document.getElementById('acc-cms-schema-prev');
        var nextBtn = document.getElementById('acc-cms-schema-next');
        var loadBtn = document.getElementById('acc-cms-schema-load-btn');
        var connStatus = document.getElementById('acc-cms-schema-conn-status');
        var listStatus = document.getElementById('acc-cms-schema-list-status');
        var listError = document.getElementById('acc-cms-schema-list-error');
        var listLoading = document.getElementById('acc-cms-schema-list-loading');

        showStep(1);
        bindTab(1);
        bindTab(2);
        bindTab(3);

        if (prevBtn) {
            prevBtn.addEventListener('click', function () {
                if (currentStep === 3) showStep(2);
                else if (currentStep === 2) showStep(1);
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', function () {
                if (currentStep === 1 && connected) showStep(2);
                else if (currentStep === 2 && typesLoaded) {
                    renderTypeList(cachedTypes);
                    showStep(3);
                }
            });
        }

        if (testBtn) {
            testBtn.addEventListener('click', function () {
                var params = 'platformId=' + encodeURIComponent(cfg.platformId);
                setStatus(connStatus, 'Testing credentials from Site Preferences...', false);
                post(cfg.testConnectionUrl, params, function (data) {
                    if (!data.ok) {
                        connected = false;
                        typesLoaded = false;
                        updateFooter(currentStep);
                        setStatus(connStatus, data.error || 'Connection failed', true);
                        return;
                    }
                    connected = true;
                    updateFooter(currentStep);
                    var name = (data.project && (data.project.name || data.project.key)) || 'Connected';
                    setStatus(connStatus, 'Connected to ' + name, false);
                });
            });
        }

        if (loadBtn) {
            loadBtn.addEventListener('click', function () {
                setStatus(listStatus, 'Loading...', false);
                if (listError) listError.style.display = 'none';
                get(cfg.listTypesUrl, function (data) {
                    if (!data.ok) {
                        typesLoaded = false;
                        updateFooter(currentStep);
                        setStatus(listStatus, '', false);
                        if (listError) {
                            listError.style.display = '';
                            listError.textContent = data.error || 'Unable to load content types';
                        }
                        return;
                    }
                    var result = data.result || {};
                    cachedTypes = result.types || [];
                    typesLoaded = cachedTypes.length > 0;
                    updateFooter(currentStep);
                    var hub = result.hubName ? ' from ' + result.hubName : '';
                    setStatus(listStatus, cachedTypes.length + ' type(s)' + hub, false);
                    if (listLoading) listLoading.style.display = 'none';
                });
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
