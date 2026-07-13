'use strict';

/**
 * Amplience CMS content migration — connect, select, preview, export IMPEX.
 */
(function () {
    var connected = false;
    var currentStep = 1;
    var currentDeliveryKey = '';
    var currentContentId = '';
    var allItems = [];

    /**
     * Read page config from data attributes.
     * @returns {Object} config values
     */
    function readCfg() {
        var root = document.getElementById('acc-cms-root');
        if (!root) return {};
        return {
            platformId: root.getAttribute('data-platform-id') || 'amplience',
            testConnectionUrl: root.getAttribute('data-test-connection-url') || '',
            listContentUrl: root.getAttribute('data-list-content-url') || '',
            fetchContentUrl: root.getAttribute('data-fetch-content-url') || '',
            exportContentUrl: root.getAttribute('data-export-content-url') || '',
            downloadXmlUrl: root.getAttribute('data-download-xml-url') || '',
            impexPath: root.getAttribute('data-impex-path') || 'src/migration/content',
            impexUrl: root.getAttribute('data-impex-url') || ''
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
     * Build form-urlencoded params from inputs.
     * @param {HTMLElement} form - form element
     * @param {string} extra - leading params
     * @returns {string} encoded params
     */
    function buildFormParams(form, extra) {
        var params = extra || '';
        var inputs = form.querySelectorAll('input[name]');
        var i = 0;
        while (i < inputs.length) {
            if (params) params += '&';
            params += encodeURIComponent(inputs[i].name) + '=' + encodeURIComponent(inputs[i].value || '');
            i += 1;
        }
        return params;
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
        var className = 'cms-panel__status cms-panel__status--inline';
        if (isError) {
            className += ' cms-panel__status--error';
        } else if (msg) {
            className += ' cms-panel__status--ok';
        }
        node.textContent = msg || '';
        node.className = className;
    }

    /**
     * Show export alert banner.
     * @param {string} msg - message
     * @param {string} kind - ok|error|info
     * @returns {void}
     */
    function setExportAlert(msg, kind) {
        var alertEl = document.getElementById('acc-cms-export-alert');
        if (!alertEl) return;
        var node = alertEl;
        if (!msg) {
            node.style.display = 'none';
            node.textContent = '';
            node.className = 'cms-export-alert';
            return;
        }
        node.style.display = '';
        node.textContent = msg;
        node.className = 'cms-export-alert cms-export-alert--' + (kind || 'info');
    }

    /**
     * Update Previous/Continue footer for the active step.
     * @param {number} step - step number
     * @returns {void}
     */
    function updateFooter(step) {
        var prevBtn = document.getElementById('acc-cms-prev');
        var nextBtn = document.getElementById('acc-cms-next');
        if (prevBtn) {
            prevBtn.style.visibility = step > 1 ? 'visible' : 'hidden';
        }
        if (nextBtn) {
            if (step === 1) {
                nextBtn.style.display = '';
                nextBtn.disabled = !connected;
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
            var panel = document.getElementById('cms-panel-step' + panels[pi]);
            if (panel) panel.style.display = panels[pi] === step ? '' : 'none';
            var tab = document.getElementById('cms-tab-' + panels[pi]);
            if (tab) {
                tab.className = 'cms-steps__tab' + (panels[pi] === step ? ' cms-steps__tab--active' : '');
                tab.disabled = panels[pi] > 1 && !connected;
            }
            pi += 1;
        }
        updateFooter(step);
    }

    /**
     * Download an XML file via XHR blob.
     * @param {string} url - download URL
     * @param {string} fileName - local filename
     * @returns {void}
     */
    function triggerBlobDownload(url, fileName) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'text';
        xhr.onload = function () {
            var blob = new Blob([xhr.responseText], { type: 'application/xml' });
            var objUrl = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = objUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(function () { URL.revokeObjectURL(objUrl); }, 1000);
        };
        xhr.send();
    }

    /**
     * Render download buttons for exported files.
     * @param {HTMLElement} container - mount node
     * @param {string[]} fileNames - file names
     * @param {string} downloadUrl - download endpoint
     * @returns {void}
     */
    function renderDownloadLinks(container, fileNames, downloadUrl) {
        if (!container) return;
        var mount = container;
        mount.innerHTML = '';
        if (!fileNames || !fileNames.length) return;
        var i = 0;
        while (i < fileNames.length) {
            (function (name) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'acc-btn acc-btn--secondary cms-download-btn';
                btn.innerHTML = '&#8681; ' + escHtml(name);
                btn.addEventListener('click', function () {
                    btn.disabled = true;
                    btn.textContent = 'Downloading...';
                    triggerBlobDownload(downloadUrl + '?fileName=' + encodeURIComponent(name), name);
                    setTimeout(function () {
                        btn.disabled = false;
                        btn.innerHTML = '&#8681; ' + escHtml(name);
                    }, 2000);
                });
                mount.appendChild(btn);
            }(fileNames[i]));
            i += 1;
        }
    }

    /**
     * Build HTML for preview field rows.
     * @param {Object[]} fields - field descriptors
     * @param {Object[]} images - image descriptors
     * @returns {string} html
     */
    function buildFieldsHtml(fields, images) {
        var html = '<ul class="cms-preview-fields">';
        var shown = {};
        var i;

        if (images && images.length) {
            for (i = 0; i < images.length; i++) {
                shown[images[i].name] = true;
                html += '<li class="cms-preview-fields__row">'
                    + '<span class="cms-preview-fields__name">' + escHtml(images[i].name) + '</span>'
                    + '<span class="cms-preview-fields__value"><img src="' + escHtml(images[i].url) + '" alt="" /></span>'
                    + '</li>';
            }
        }

        if (fields && fields.length) {
            for (i = 0; i < fields.length; i++) {
                var f = fields[i];
                if (!shown[f.name] && f.type !== 'image') {
                    html += '<li class="cms-preview-fields__row">'
                        + '<span class="cms-preview-fields__name">' + escHtml(f.name) + '</span>'
                        + '<span class="cms-preview-fields__value">' + escHtml(f.value) + '</span>'
                        + '</li>';
                }
            }
        }

        html += '</ul>';
        return html;
    }

    /**
     * Render widget preview UI.
     * @param {Object} widget - mapped widget
     * @returns {void}
     */
    function renderPreview(widget) {
        var emptyEl = document.getElementById('acc-cms-widget-empty');
        var previewEl = document.getElementById('acc-cms-widget-preview');
        var errorEl = document.getElementById('acc-cms-widget-error');
        var cardEl = document.getElementById('acc-cms-preview-card');
        var badgeEl = document.getElementById('acc-cms-widget-type');
        var downloads = document.getElementById('acc-cms-export-downloads');

        if (!widget) {
            if (emptyEl) emptyEl.style.display = '';
            if (previewEl) previewEl.style.display = 'none';
            if (errorEl) errorEl.style.display = 'none';
            currentDeliveryKey = '';
            currentContentId = '';
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';
        if (previewEl) previewEl.style.display = '';
        if (errorEl) errorEl.style.display = 'none';
        if (downloads) downloads.innerHTML = '';
        setExportAlert('', '');

        currentDeliveryKey = widget.deliveryKey || '';
        currentContentId = widget.contentId || currentContentId || '';
        var schemaLabel = widget.schemaShort || widget.schema || '—';
        document.getElementById('acc-cms-preview-key').textContent = widget.deliveryKey || '(no delivery key)';
        document.getElementById('acc-cms-preview-component').textContent = widget.widgetType || '';
        document.getElementById('acc-cms-preview-schema').textContent = schemaLabel;
        document.getElementById('acc-cms-preview-json').textContent = JSON.stringify(widget.attributes || {}, null, 2);
        if (badgeEl) badgeEl.textContent = widget.widgetLabel || widget.widgetType || '';

        var preview = widget.preview || {};
        var attrs = widget.attributes || {};
        var fields = preview.fields || attrs.previewFields || [];
        var images = preview.images || attrs.previewImages || [];
        var html = '<h3 class="cms-preview-card__title">'
            + escHtml(preview.title || widget.deliveryKey || 'Content')
            + '</h3>';

        if (preview.image) {
            html += '<img class="cms-preview-card__image" src="' + escHtml(preview.image) + '" alt="" />';
        }
        if (preview.body) {
            html += '<div class="cms-preview-card__body">' + escHtml(preview.body) + '</div>';
        } else if (attrs.richText) {
            html += '<div class="cms-preview-card__body">' + attrs.richText + '</div>';
        } else if (attrs.bannerMessage) {
            html += '<div class="cms-preview-card__body">' + attrs.bannerMessage + '</div>';
        }

        if (fields.length || images.length) {
            html += '<details class="cms-fields-details">'
                + '<summary>Component fields (' + (fields.length || images.length) + ')</summary>'
                + buildFieldsHtml(fields, images)
                + '</details>';
        } else if (!preview.body && !preview.image) {
            html += '<p class="cms-muted">No simple text/image fields found. Open Widget attributes (JSON) if needed.</p>';
        }

        if (cardEl) cardEl.innerHTML = html;
    }

    /**
     * Fetch and preview content by delivery key or content id.
     * @param {Object} cfg - page config
     * @param {Object} opts - fetch options
     * @returns {void}
     */
    function fetchContent(cfg, opts) {
        var errorEl = document.getElementById('acc-cms-widget-error');
        if (errorEl) {
            errorEl.style.display = 'none';
            errorEl.textContent = '';
        }

        showStep(3);

        var qs = [];
        // Prefer content id (Management API) so unpublished / keyless items preview reliably.
        if (opts.contentId) qs.push('contentId=' + encodeURIComponent(opts.contentId));
        if (opts.deliveryKey && !opts.contentId) {
            qs.push('deliveryKey=' + encodeURIComponent(opts.deliveryKey));
        }
        currentContentId = opts.contentId || '';
        currentDeliveryKey = opts.deliveryKey || '';

        var url = cfg.fetchContentUrl
            + (cfg.fetchContentUrl.indexOf('?') >= 0 ? '&' : '?')
            + qs.join('&');

        get(url, function (data) {
            if (!data.ok) {
                if (errorEl) {
                    errorEl.style.display = '';
                    errorEl.textContent = data.error || 'Fetch failed';
                }
                return;
            }
            if (data.fetched) {
                if (data.fetched.contentId) currentContentId = data.fetched.contentId;
                if (data.fetched.deliveryKey) currentDeliveryKey = data.fetched.deliveryKey;
            }
            renderPreview(data.widget);
        });
    }

    /**
     * Export the previewed content to IMPEX and auto-download.
     * @param {Object} cfg - page config
     * @returns {void}
     */
    function exportToImpex(cfg) {
        var exportBtn = document.getElementById('acc-cms-export-btn');
        var downloads = document.getElementById('acc-cms-export-downloads');
        var key = currentDeliveryKey
            || ((document.getElementById('acc-cms-delivery-key') || {}).value || '').trim();
        var id = currentContentId;

        if (!key && !id) {
            setExportAlert('Preview a content item first', 'error');
            return;
        }

        if (exportBtn) exportBtn.disabled = true;
        setExportAlert('Writing content attributes + library content-asset XML to IMPEX...', 'info');

        // Prefer content id so items without a published delivery key still export.
        var params = id
            ? 'contentId=' + encodeURIComponent(id)
            : 'deliveryKey=' + encodeURIComponent(key);

        post(cfg.exportContentUrl, params, function (data) {
            if (exportBtn) exportBtn.disabled = false;
            if (!data.ok) {
                setExportAlert(data.error || 'Export failed', 'error');
                return;
            }
            var built = data.built || 1;
            var lib = data.libraryId ? (' into library "' + data.libraryId + '"') : '';
            setExportAlert(
                'Exported ' + built + ' content asset(s)' + lib
                    + '. Import metadata XML first, then library XML in BM Import & Export.',
                'ok'
            );
            var names = data.fileNames && data.fileNames.length
                ? data.fileNames
                : [data.metaFileName, data.fileName].filter(Boolean);
            if (names.length) {
                renderDownloadLinks(downloads, names, cfg.downloadXmlUrl);
                // Auto-download library XML (primary asset file)
                var primary = data.fileName || names[names.length - 1];
                if (primary) {
                    triggerBlobDownload(
                        cfg.downloadXmlUrl + '?fileName=' + encodeURIComponent(primary),
                        primary
                    );
                }
            }
        });
    }

    /**
     * Populate repository and schema filter dropdowns.
     * @param {Object[]} repositories - repo summaries
     * @param {string[]} schemas - schema short names
     * @returns {void}
     */
    function fillFilterOptions(repositories, schemas) {
        var repoSel = document.getElementById('acc-cms-filter-repo');
        var schemaSel = document.getElementById('acc-cms-filter-schema');
        var filters = document.getElementById('acc-cms-filters');
        var i;

        if (filters) filters.style.display = '';

        if (repoSel) {
            while (repoSel.options.length > 1) repoSel.remove(1);
            for (i = 0; i < (repositories || []).length; i++) {
                var r = repositories[i];
                var opt = document.createElement('option');
                opt.value = r.name || r.label || '';
                opt.textContent = (r.label || r.name) + (r.count != null ? ' (' + r.count + ')' : '');
                repoSel.appendChild(opt);
            }
        }

        if (schemaSel) {
            while (schemaSel.options.length > 1) schemaSel.remove(1);
            for (i = 0; i < (schemas || []).length; i++) {
                var sOpt = document.createElement('option');
                sOpt.value = schemas[i];
                sOpt.textContent = schemas[i];
                schemaSel.appendChild(sOpt);
            }
        }
    }

    /**
     * Apply current filter controls to loaded items.
     * @returns {Object[]} filtered items
     */
    function getFilteredItems() {
        var repo = ((document.getElementById('acc-cms-filter-repo') || {}).value || '').toLowerCase();
        var schema = ((document.getElementById('acc-cms-filter-schema') || {}).value || '').toLowerCase();
        var search = ((document.getElementById('acc-cms-filter-search') || {}).value || '').toLowerCase();
        var out = [];
        var i = 0;
        while (i < allItems.length) {
            var item = allItems[i];
            var repoVal = String(item.repoName || item.repoLabel || '').toLowerCase();
            var schemaVal = String(item.schemaShort || '').toLowerCase();
            var hay = (item.label + ' ' + (item.deliveryKey || '') + ' ' + schemaVal).toLowerCase();
            var include = true;
            if (repo && repoVal !== repo && String(item.repoLabel || '').toLowerCase() !== repo) {
                include = false;
            }
            if (include && schema && schemaVal !== schema) {
                include = false;
            }
            if (include && search && hay.indexOf(search) < 0) {
                include = false;
            }
            if (include) out.push(item);
            i += 1;
        }
        return out;
    }

    /**
     * Render the content list table.
     * @param {Object[]} items - rows to show
     * @returns {void}
     */
    function renderContentList(items) {
        var tbody = document.getElementById('acc-cms-tbody');
        var wrap = document.getElementById('acc-cms-table-wrap');
        var loading = document.getElementById('acc-cms-list-loading');
        var listStatus = document.getElementById('acc-cms-list-status');
        if (!tbody || !wrap) return;

        var html = '';
        var i = 0;
        while (i < items.length) {
            var item = items[i];
            var key = item.deliveryKey || '';
            var id = item.id || '';
            html += '<tr>';
            html += '<td class="cms-col-label"><span class="cms-label-text">' + escHtml(item.label) + '</span></td>';
            html += '<td class="cms-col-repo">' + escHtml(item.repoLabel || item.repoName || '—') + '</td>';
            html += '<td class="cms-col-key"><code>' + escHtml(key || '—') + '</code></td>';
            html += '<td class="cms-col-schema">' + escHtml(item.schemaShort || '—') + '</td>';
            html += '<td class="cms-col-status">' + escHtml(item.status || '—') + '</td>';
            html += '<td class="cms-col-action">';
            if (key || id) {
                html += '<button type="button" class="acc-btn acc-btn--ghost acc-cms-preview-btn"'
                    + (key ? ' data-key="' + escHtml(key) + '"' : '')
                    + (id ? ' data-id="' + escHtml(id) + '"' : '')
                    + '>Preview</button>';
            } else {
                html += '<span class="cms-muted" style="font-size:11px;">Unavailable</span>';
            }
            html += '</td>';
            html += '</tr>';
            i += 1;
        }

        tbody.innerHTML = html || '<tr><td colspan="6" class="cms-muted">No items match the current filters.</td></tr>';
        wrap.style.display = '';
        if (loading) loading.style.display = 'none';
        if (listStatus) {
            listStatus.textContent = items.length + ' shown / ' + allItems.length + ' loaded';
            listStatus.className = 'cms-panel__status cms-panel__status--ok';
        }

        var buttons = tbody.querySelectorAll('.acc-cms-preview-btn');
        var cfg = readCfg();
        var bi = 0;
        while (bi < buttons.length) {
            buttons[bi].addEventListener('click', function onPreviewClick() {
                var keyVal = this.getAttribute('data-key') || '';
                var idVal = this.getAttribute('data-id') || '';
                if (keyVal) {
                    document.getElementById('acc-cms-delivery-key').value = keyVal;
                }
                fetchContent(cfg, { deliveryKey: keyVal, contentId: idVal });
            });
            bi += 1;
        }
    }

    /**
     * Re-render list using active filters.
     * @returns {void}
     */
    function applyFilters() {
        renderContentList(getFilteredItems());
    }

    /**
     * Bind a step tab click handler.
     * @param {number} stepNum - step number
     * @returns {void}
     */
    function bindTab(stepNum) {
        var tab = document.getElementById('cms-tab-' + stepNum);
        if (!tab) return;
        tab.addEventListener('click', function () {
            if (stepNum > 1 && !connected) return;
            showStep(stepNum);
        });
    }

    /**
     * Initialize the content migration page.
     * @returns {void}
     */
    function init() {
        var cfg = readCfg();
        var form = document.getElementById('acc-cms-connect-form');
        var testBtn = document.getElementById('acc-cms-test-btn');
        var prevBtn = document.getElementById('acc-cms-prev');
        var nextBtn = document.getElementById('acc-cms-next');
        var loadBtn = document.getElementById('acc-cms-load-btn');
        var fetchBtn = document.getElementById('acc-cms-fetch-btn');
        var exportBtn = document.getElementById('acc-cms-export-btn');
        var connStatus = document.getElementById('acc-cms-conn-status');
        var listStatus = document.getElementById('acc-cms-list-status');
        var listError = document.getElementById('acc-cms-list-error');
        var defaultKeyInput = document.getElementById('cms-defaultDeliveryKey');
        var deliveryKeyInput = document.getElementById('acc-cms-delivery-key');
        var filterRepo = document.getElementById('acc-cms-filter-repo');
        var filterSchema = document.getElementById('acc-cms-filter-schema');
        var filterSearch = document.getElementById('acc-cms-filter-search');

        if (defaultKeyInput && deliveryKeyInput && defaultKeyInput.value) {
            deliveryKeyInput.value = defaultKeyInput.value;
        }

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
            });
        }

        if (testBtn && form) {
            testBtn.addEventListener('click', function () {
                var params = buildFormParams(form, 'platformId=' + encodeURIComponent(cfg.platformId));
                setStatus(connStatus, 'Testing...', false);
                post(cfg.testConnectionUrl, params, function (data) {
                    if (!data.ok) {
                        connected = false;
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
                get(cfg.listContentUrl, function (data) {
                    if (!data.ok) {
                        setStatus(listStatus, '', false);
                        if (listError) {
                            listError.style.display = '';
                            listError.textContent = data.error || 'Unable to load content';
                        }
                        return;
                    }
                    var result = data.result || {};
                    allItems = result.items || [];
                    fillFilterOptions(result.repositories || [], result.schemas || []);
                    applyFilters();
                });
            });
        }

        if (filterRepo) filterRepo.addEventListener('change', applyFilters);
        if (filterSchema) filterSchema.addEventListener('change', applyFilters);
        if (filterSearch) {
            filterSearch.addEventListener('input', applyFilters);
            filterSearch.addEventListener('keyup', applyFilters);
        }

        if (fetchBtn) {
            fetchBtn.addEventListener('click', function () {
                var key = (document.getElementById('acc-cms-delivery-key').value || '').trim();
                if (!key) return;
                fetchContent(cfg, { deliveryKey: key });
            });
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', function () {
                exportToImpex(cfg);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
