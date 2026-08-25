'use strict';

/**
 * Amplience CMS content migration — connect, select, preview, export IMPEX.
 */
(function () {
    var connected = false;
    var contentLoaded = false;
    var contentLoading = false;
    var loadContentListFn = null;
    var currentStep = 1;
    var currentDeliveryKey = '';
    var currentContentId = '';
    var allItems = [];
    var visibleItems = [];

    /**
     * Read page config from data attributes.
     * @returns {Object} config values
     */
    function readCfg() {
        var root = document.getElementById('acc-cms-root');
        if (!root) return {};
        return {
            platformId: root.getAttribute('data-platform-id') || 'amplience',
            connected: root.getAttribute('data-connected') === 'true',
            initialStep: parseInt(root.getAttribute('data-initial-step') || '1', 10),
            testConnectionUrl: root.getAttribute('data-test-connection-url') || '',
            listContentUrl: root.getAttribute('data-list-content-url') || '',
            fetchContentUrl: root.getAttribute('data-fetch-content-url') || '',
            previewLibraryUrl: root.getAttribute('data-preview-library-url') || '',
            exportContentUrl: root.getAttribute('data-export-content-url') || '',
            listMigratedRefsUrl: root.getAttribute('data-list-migrated-refs-url') || '',
            downloadXmlUrl: root.getAttribute('data-download-xml-url') || '',
            impexPath: root.getAttribute('data-impex-path') || 'src/migration/content',
            impexUrl: root.getAttribute('data-impex-url') || '',
            defaultDeliveryKey: root.getAttribute('data-default-delivery-key') || ''
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
     * @param {number} [status] - HTTP status
     * @param {string} [context] - connect|export — tunes non-JSON error text
     * @returns {Object} parsed payload
     */
    function parseJsonResponse(raw, fallbackError, status, context) {
        if (!raw || !String(raw).trim()) {
            return {
                ok: false,
                error: (fallbackError || 'Empty response from server')
                    + (status ? ' (HTTP ' + status + ')' : '')
            };
        }
        try {
            return JSON.parse(raw);
        } catch (e) {
            var snippet = String(raw).replace(/\s+/g, ' ').slice(0, 120);
            var looksLikeHtml = /<html|<body|Business Manager/i.test(raw);
            var looksLikeTimeout = /timeout|timed out|time-out/i.test(raw);
            var isConnect = context === 'connect';

            if (isConnect) {
                if (looksLikeHtml || looksLikeTimeout) {
                    return {
                        ok: false,
                        error: 'Connection test failed — the server returned a Business Manager page instead of JSON'
                            + (status ? ' (HTTP ' + status + ')' : '')
                            + '. Set Amplience credentials under Site Preferences → B2C Migration Console, then click Test Connection again.'
                            + ' If this persists, run npm run upload:accelerator and import impex/install/services.xml.'
                    };
                }
                return {
                    ok: false,
                    error: 'Connection test failed — server returned non-JSON'
                        + (status ? ' (HTTP ' + status + ')' : '')
                        + (snippet ? ': ' + snippet : '')
                };
            }

            if (looksLikeHtml || looksLikeTimeout) {
                return {
                    ok: false,
                    error: 'Export timed out on the server (HTTP ' + (status || '?')
                        + '). Retry — batches are smaller now, or filter to fewer items.'
                };
            }
            return {
                ok: false,
                error: 'Server returned HTTP ' + (status || 'error')
                    + ' instead of JSON'
                    + (snippet ? ' ("' + snippet + '...")' : '')
                    + '. Retry the export.'
            };
        }
    }

    /**
     * POST form-encoded data.
     * @param {string} url - endpoint
     * @param {string} params - body
     * @param {Function} onDone - callback
     * @param {string} [context] - connect|export — tunes non-JSON error text
     * @returns {void}
     */
    function post(url, params, onDone, context) {
        var req = new XMLHttpRequest();
        req.open('POST', url, true);
        req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.setRequestHeader('Accept', 'application/json');
        req.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        req.onreadystatechange = function () {
            if (req.readyState !== 4) return;
            onDone(parseJsonResponse(req.responseText, 'Parse error', req.status, context));
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
            onDone(parseJsonResponse(req.responseText, 'Parse error', req.status));
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
     * Show the Step 2 bulk action status.
     * @param {string} msg - message
     * @param {string} kind - ok|error|info
     * @returns {void}
     */
    function setBulkStatus(msg, kind) {
        var node = document.getElementById('acc-cms-bulk-status');
        if (!node) return;
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
     * Copy the connect-step default delivery key into the step 2 fetch field.
     * @returns {void}
     */
    function syncDeliveryKeyToStep2() {
        var deliveryKeyInput = document.getElementById('acc-cms-delivery-key');
        var defaultKeyInput = document.getElementById('cms-defaultDeliveryKey');
        if (!deliveryKeyInput) return;
        var fromConnect = defaultKeyInput ? String(defaultKeyInput.value || '').trim() : '';
        if (fromConnect) {
            deliveryKeyInput.value = fromConnect;
        }
    }

    /**
     * Use the first published delivery key from loaded content when the field is empty.
     * @param {Object[]} items - loaded Amplience content rows
     * @returns {void}
     */
    function suggestFirstDeliveryKey(items) {
        var deliveryKeyInput = document.getElementById('acc-cms-delivery-key');
        if (!deliveryKeyInput || String(deliveryKeyInput.value || '').trim()) return;
        var i;
        for (i = 0; i < (items || []).length; i++) {
            var key = String(items[i].deliveryKey || '').trim();
            if (key) {
                deliveryKeyInput.value = key;
                return;
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
        if (step === 2) {
            syncDeliveryKeyToStep2();
            if (connected && loadContentListFn) {
                loadContentListFn(readCfg(), false);
            }
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
            var mime = /\.json$/i.test(fileName) ? 'application/json' : 'application/xml';
            var blob = new Blob([xhr.responseText], { type: mime });
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
     * Collapse locale-suffixed preview fields into dropdown rows.
     * @param {Object[]} fields - Flat preview field descriptors
     * @returns {Object[]} Grouped fields with localized dropdown options
     */
    function groupLocalizedPreviewFields(fields) {
        if (!fields || !fields.length) return [];

        var output = [];
        var groupMap = {};
        var groupOrder = [];
        var i;
        var field;
        var match;
        var baseName;
        var suffix;

        /**
         * Format a locale key for dropdown display.
         * @param {string} localeKey - Locale or index suffix
         * @returns {string} Display label
         */
        function formatLocaleLabel(localeKey) {
            var key = String(localeKey || '').trim();
            if (!key) return 'Value';
            if (/^[a-z]{2}([-_][a-z]{2})?$/i.test(key)) {
                return key.toUpperCase().replace('_', '-');
            }
            if (/^\d+$/.test(key)) {
                return 'Item ' + (parseInt(key, 10) + 1);
            }
            return key;
        }

        /**
         * Flush accumulated locale field groups into output.
         * @returns {void}
         */
        function flushGroups() {
            var g;
            var base;
            var items;
            var preferred;
            var j;

            for (g = 0; g < groupOrder.length; g++) {
                base = groupOrder[g];
                items = groupMap[base];
                if (items && items.length) {
                    if (items.length === 1) {
                        output.push({
                            name: base + '[' + items[0].locale + ']',
                            type: items[0].type,
                            value: items[0].value
                        });
                    } else {
                        preferred = items[0];
                        for (j = 0; j < items.length; j++) {
                            if (String(items[j].locale).toLowerCase().indexOf('en') === 0) {
                                preferred = items[j];
                                break;
                            }
                        }

                        output.push({
                            name: base,
                            type: 'localized',
                            value: preferred.value,
                            options: items
                        });
                    }
                }
            }

            groupMap = {};
            groupOrder = [];
        }

        for (i = 0; i < fields.length; i++) {
            field = fields[i];
            match = String(field.name || '').match(/^(.+)\[([^\]]+)\]$/);
            if (match) {
                baseName = match[1];
                suffix = match[2];
                if (!groupMap[baseName]) {
                    groupMap[baseName] = [];
                    groupOrder.push(baseName);
                }
                groupMap[baseName].push({
                    locale: suffix,
                    label: formatLocaleLabel(suffix),
                    value: field.value,
                    type: field.type || 'text'
                });
            } else {
                flushGroups();
                output.push(field);
            }
        }

        flushGroups();
        return output;
    }

    /**
     * Build HTML for preview field rows.
     * @param {Object[]} fields - field descriptors
     * @param {Object[]} images - image descriptors
     * @returns {string} html
     */
    function buildFieldsHtml(fields, images) {
        var groupedFields = groupLocalizedPreviewFields(fields || []);
        var html = '<ul class="cms-preview-fields">';
        var shown = {};
        var i;
        var j;

        if (images && images.length) {
            for (i = 0; i < images.length; i++) {
                shown[images[i].name] = true;
                html += '<li class="cms-preview-fields__row">'
                    + '<span class="cms-preview-fields__name">' + escHtml(images[i].name) + '</span>'
                    + '<span class="cms-preview-fields__value cms-preview-fields__value--image">'
                    + '<img src="' + escHtml(images[i].url) + '" alt="" />'
                    + '<code class="cms-image-url">' + escHtml(images[i].url) + '</code>'
                    + '</span>'
                    + '</li>';
            }
        }

        for (i = 0; i < groupedFields.length; i++) {
            var f = groupedFields[i];
            if (!shown[f.name]) {
                if (f.type === 'localized' && f.options && f.options.length) {
                    html += '<li class="cms-preview-fields__row cms-preview-fields__row--localized">'
                        + '<span class="cms-preview-fields__name">' + escHtml(f.name) + '</span>'
                        + '<span class="cms-preview-fields__value">'
                        + '<span class="cms-locale-toolbar">'
                        + '<span class="cms-locale-toolbar__label">Lang</span>'
                        + '<select class="cms-locale-select" aria-label="' + escHtml(f.name) + ' locale">';
                    for (j = 0; j < f.options.length; j++) {
                        html += '<option value="' + j + '"' + (j === 0 ? ' selected' : '') + '>'
                            + escHtml(f.options[j].label) + '</option>';
                    }
                    html += '</select></span>';
                    for (j = 0; j < f.options.length; j++) {
                        html += '<span class="cms-locale-panel' + (j === 0 ? '' : ' cms-locale-panel--hidden')
                            + '" data-locale-index="' + j + '">'
                            + escHtml(String(f.options[j].value || ''))
                            + '</span>';
                    }
                    html += '</span></li>';
                } else if (f.type !== 'image') {
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
        var sourceJson = document.getElementById('acc-cms-source-json');
        if (sourceJson) {
            sourceJson.textContent = JSON.stringify({
                metadata: widget.sourceMetadata || {},
                item:     widget.source || {}
            }, null, 2);
        }
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
     * Read the active Step 2 filter values.
     * @returns {Object} active selection criteria
     */
    function getSelectionCriteria() {
        var repo = (document.getElementById('acc-cms-filter-repo') || {}).value || '';
        var schema = (document.getElementById('acc-cms-filter-schema') || {}).value || '';
        var search = (document.getElementById('acc-cms-filter-search') || {}).value || '';
        return {
            repository: repo,
            schemaType: schema,
            search:     search
        };
    }

    /**
     * Return content IDs from the currently visible filtered rows.
     * @returns {string[]} selected content IDs
     */
    function getSelectedContentIds() {
        var ids = [];
        var i;
        for (i = 0; i < visibleItems.length; i++) {
            if (visibleItems[i].id) ids.push(visibleItems[i].id);
        }
        return ids;
    }

    /**
     * Split an array into fixed-size chunks.
     * @param {Array} items - source items
     * @param {number} size - chunk size
     * @returns {Array[]} chunks
     */
    function chunkArray(items, size) {
        var chunks = [];
        var i = 0;
        var step = size || 5;
        while (i < items.length) {
            chunks.push(items.slice(i, i + step));
            i += step;
        }
        return chunks;
    }

    /**
     * Build a form payload for a bulk preview or export batch.
     * @param {string[]} ids - content IDs for this batch
     * @param {Object} [extra] - optional fields (appendFile, totalRequested)
     * @returns {string} form-encoded payload
     */
    function buildBulkParams(ids, extra) {
        var params = 'contentIds=' + encodeURIComponent((ids || []).join(','))
            + '&selection=' + encodeURIComponent(JSON.stringify(getSelectionCriteria()));
        if (extra && extra.appendFile) {
            params += '&appendFile=' + encodeURIComponent(extra.appendFile);
        }
        if (extra && extra.totalRequested) {
            params += '&totalRequested=' + encodeURIComponent(String(extra.totalRequested));
        }
        if (extra && typeof extra.finalize !== 'undefined') {
            params += '&finalize=' + (extra.finalize ? '1' : '0');
        }
        return params;
    }

    /**
     * Render a compact library preview summary (not the full JSON dump).
     * @param {Object} summary - preview summary from server
     * @param {string} fileName - downloadable JSON file
     * @returns {void}
     */
    function renderLibrarySummary(summary, fileName) {
        var wrap = document.getElementById('acc-cms-library-preview');
        var meta = document.getElementById('acc-cms-library-preview-meta');
        var box = document.getElementById('acc-cms-library-preview-summary');
        var previewJson = document.getElementById('acc-cms-library-preview-json');
        var details = wrap ? wrap.querySelector('.cms-library-preview__details') : null;
        if (!wrap || !box) return;

        var types = (summary && summary.contentTypes) || [];
        var typeLabels = [];
        var ti;
        for (ti = 0; ti < types.length && ti < 12; ti++) {
            typeLabels.push(types[ti].schemaShort || types[ti].schema || '');
        }

        var html = '<ul class="cms-library-preview__list">'
            + '<li><strong>Fetched:</strong> ' + escHtml(String((summary && summary.totalFetched) || 0)) + '</li>'
            + '<li><strong>Failed:</strong> ' + escHtml(String((summary && summary.failed) || 0)) + '</li>'
            + '<li><strong>Content types:</strong> ' + escHtml(typeLabels.join(', ') || '—') + '</li>'
            + '</ul>';
        box.innerHTML = html;
        if (meta) {
            meta.textContent = fileName
                ? ('Full JSON saved as ' + fileName + ' — use Download below.')
                : '';
        }
        if (previewJson) {
            previewJson.textContent = JSON.stringify((summary && summary.sample) || [], null, 2);
        }
        if (details) details.open = false;
        wrap.style.display = '';
    }

    /**
     * Run a batched POST sequence for preview or export.
     * @param {Object} cfg - page config
     * @param {Object} opts - batch options
     * @returns {void}
     */
    function runBatchedRequest(cfg, opts) {
        var ids = opts.ids || getSelectedContentIds();
        var batchSize = opts.batchSize || 5;
        var chunks = chunkArray(ids, batchSize);
        var button = document.getElementById(opts.buttonId);
        var downloads = document.getElementById('acc-cms-bulk-downloads');
        var processed = 0;
        var attempted = 0;
        var failed = 0;
        var fileName = '';
        var metaFileName = '';
        var libraryId = '';
        var lastSummary = null;
        var chunkIndex = 0;
        var isExport = !!opts.finalizeBatches;

        if (!ids.length) {
            setBulkStatus('No content items match the current filters.', 'error');
            return;
        }
        if (!opts.url) {
            setBulkStatus('Bulk endpoint is missing. Redeploy the accelerator cartridge.', 'error');
            return;
        }
        if (button) button.disabled = true;
        if (downloads) downloads.innerHTML = '';
        setBulkStatus(opts.startMsg.replace('{n}', String(ids.length)), 'info');

        /**
         * Complete the current batch sequence.
         * @param {boolean} ok - whether all requests completed
         * @param {string} message - final status
         * @param {string} [kind] - alert style
         * @returns {void}
         */
        function finish(ok, message, kind) {
            if (button) button.disabled = false;
            setBulkStatus(message, kind || (ok ? 'ok' : 'error'));
            var names = [];
            if (metaFileName) names.push(metaFileName);
            if (fileName) names.push(fileName);
            if (downloads && names.length) {
                renderDownloadLinks(downloads, names, cfg.downloadXmlUrl);
            }
            if (ok && opts.onSuccess) opts.onSuccess(lastSummary, fileName);
        }

        /**
         * Close an open export file after a mid-batch failure (best effort).
         * @param {Function} done - callback after finalize attempt
         * @returns {void}
         */
        function finalizeOpenFile(done) {
            if (!isExport || !fileName) {
                done();
                return;
            }
            post(opts.url, buildBulkParams([], {
                appendFile: fileName,
                finalize: true,
                totalRequested: ids.length
            }), function () { done(); });
        }

        /**
         * Process the next batch sequentially.
         * @returns {void}
         */
        function next() {
            if (chunkIndex >= chunks.length) {
                finish(true, opts.doneMsg
                    .replace('{built}', String(processed))
                    .replace('{failed}', String(failed))
                    .replace('{library}', libraryId || ''), failed ? 'info' : 'ok');
                return;
            }
            var batch = chunks[chunkIndex];
            var isLast = chunkIndex === chunks.length - 1;
            setBulkStatus(
                opts.progressMsg
                    .replace('{done}', String(Math.min(attempted + batch.length, ids.length)))
                    .replace('{total}', String(ids.length)),
                'info'
            );
            post(opts.url, buildBulkParams(batch, {
                appendFile: fileName,
                totalRequested: ids.length,
                finalize: isExport ? isLast : undefined
            }), function (data) {
                if (!data.ok) {
                    finalizeOpenFile(function () {
                        finish(false, data.error || opts.failMsg);
                    });
                    return;
                }
                processed += typeof data.built === 'number' ? data.built : batch.length;
                attempted += batch.length;
                failed += data.failed || 0;
                if (data.fileName) fileName = data.fileName;
                if (data.metaFileName) metaFileName = data.metaFileName;
                if (data.libraryId) libraryId = data.libraryId;
                if (data.summary) lastSummary = data.summary;
                if (data.fileNames && data.fileNames.length) {
                    if (data.fileNames[0]) metaFileName = data.fileNames[0];
                    if (data.fileNames[1]) fileName = data.fileNames[1];
                }
                chunkIndex += 1;
                next();
            });
        }

        next();
    }

    /**
     * Generate and render one JSON preview for the current selection.
     * @param {Object} cfg - page config
     * @returns {void}
     */
    function previewLibrary(cfg) {
        runBatchedRequest(cfg, {
            url: cfg.previewLibraryUrl,
            buttonId: 'acc-cms-preview-all-btn',
            batchSize: 5,
            startMsg: 'Building library JSON for {n} item(s) in batches...',
            progressMsg: 'Previewing {done}/{total}...',
            doneMsg: 'Preview ready: {built} item(s). Download the JSON file below.',
            failMsg: 'Library preview failed',
            onSuccess: function (summary, fileName) {
                renderLibrarySummary(summary || {
                    totalFetched: visibleItems.length,
                    failed: 0,
                    contentTypes: [],
                    sample: []
                }, fileName);
            }
        });
    }

    /**
     * Export the current selection as SFCC library XML.
     * @param {Object} cfg - page config
     * @returns {void}
     */
    function exportLibrary(cfg) {
        runBatchedRequest(cfg, {
            url: cfg.exportContentUrl,
            buttonId: 'acc-cms-export-library-btn',
            batchSize: 5,
            finalizeBatches: true,
            startMsg: 'Exporting {n} item(s) to SFCC library XML in batches...',
            progressMsg: 'Exporting {done}/{total}...',
            doneMsg: 'Exported {built} asset(s) into library "{library}". Import metadata XML first, then library XML. Failed: {failed}.',
            failMsg: 'Library export failed'
        });
    }

    /**
     * Re-fetch the currently filtered Amplience items and write updated IMPEX XML.
     * Uses the same selection as Export XML (visible filtered rows), not the whole folder.
     * @param {Object} cfg - page config
     * @returns {void}
     */
    function resyncMigratedFolder(cfg) {
        var ids = getSelectedContentIds();
        if (!ids.length) {
            setBulkStatus(
                'No items match the current filter. Load content and narrow the filter, '
                    + 'or clear filters to re-sync the visible list.',
                'error'
            );
            return;
        }

        runBatchedRequest(cfg, {
            ids: ids,
            url: cfg.exportContentUrl,
            buttonId: 'acc-cms-resync-migrated-btn',
            batchSize: 5,
            finalizeBatches: true,
            startMsg: 'Re-syncing {n} filtered item(s) from Amplience...',
            progressMsg: 'Re-syncing {done}/{total}...',
            doneMsg: 'Re-synced {built} filtered item(s) into IMPEX for library "{library}". '
                + 'Import metadata XML first, then library XML in BM if you need the SFCC snapshot updated. '
                + 'Storefront live CDN does not require this import. Failed: {failed}.',
            failMsg: 'Filtered item re-sync failed'
        });
    }

    /**
     * Build unique content-type options from loaded items.
     * @param {Object[]} items - loaded content rows
     * @returns {string[]} schema short names
     */
    function collectSchemasFromItems(items) {
        var map = {};
        var out = [];
        var i;
        for (i = 0; i < (items || []).length; i++) {
            var name = String(items[i].schemaShort || '').trim();
            if (name && !map[name]) {
                map[name] = true;
                out.push(name);
            }
        }
        out.sort();
        return out;
    }

    /**
     * Populate repository and content-type filter dropdowns.
     * @param {Object[]} repositories - repo summaries
     * @param {string[]} schemas - schema short names
     * @returns {void}
     */
    function fillFilterOptions(repositories, schemas) {
        var repoSel = document.getElementById('acc-cms-filter-repo');
        var schemaSel = document.getElementById('acc-cms-filter-schema');
        var filters = document.getElementById('acc-cms-filters');
        var searchInput = document.getElementById('acc-cms-filter-search');
        var i;
        var schemaList = (schemas && schemas.length) ? schemas : collectSchemasFromItems(allItems);

        if (filters) filters.style.display = '';
        if (searchInput) searchInput.style.display = '';

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
            for (i = 0; i < schemaList.length; i++) {
                var sOpt = document.createElement('option');
                sOpt.value = schemaList[i];
                sOpt.textContent = schemaList[i];
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
            var hay = (item.label + ' ' + (item.id || '') + ' ' + (item.deliveryKey || '') + ' '
                + repoVal + ' ' + schemaVal + ' ' + (item.status || '')).toLowerCase();
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
        var items = getFilteredItems();
        var previewButton = document.getElementById('acc-cms-preview-all-btn');
        var exportButton = document.getElementById('acc-cms-export-library-btn');
        var count = document.getElementById('acc-cms-selection-count');
        var actions = document.getElementById('acc-cms-bulk-actions');
        var criteria = getSelectionCriteria();
        var isFiltered = !!(criteria.repository || criteria.schemaType || criteria.search);

        visibleItems = items;
        renderContentList(items);
        if (actions) actions.style.display = allItems.length ? '' : 'none';
        if (count) count.textContent = String(items.length);
        if (previewButton) {
            previewButton.textContent = (isFiltered ? 'Preview Filtered JSON' : 'Preview JSON')
                + ' (' + items.length + ')';
            previewButton.disabled = !items.length;
        }
        if (exportButton) {
            exportButton.textContent = (isFiltered ? 'Export Filtered XML' : 'Export XML')
                + ' (' + items.length + ')';
            exportButton.disabled = !items.length;
        }
    }

    /**
     * Fetch content items from Amplience and render the step 2 table.
     * @param {Object} cfg - page config
     * @param {boolean} [forceReload] - reload even when already loaded
     * @returns {void}
     */
    function loadContentList(cfg, forceReload) {
        if (contentLoading) return;
        if (contentLoaded && !forceReload) return;

        var listStatus = document.getElementById('acc-cms-list-status');
        var listError = document.getElementById('acc-cms-list-error');
        var loadBtn = document.getElementById('acc-cms-load-btn');
        var loading = document.getElementById('acc-cms-list-loading');

        contentLoading = true;
        if (loadBtn) loadBtn.disabled = true;
        if (loading) loading.style.display = '';
        setStatus(listStatus, 'Loading...', false);
        if (listError) {
            listError.style.display = 'none';
            listError.textContent = '';
        }

        get(cfg.listContentUrl, function (data) {
            contentLoading = false;
            if (loadBtn) loadBtn.disabled = false;
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
            contentLoaded = true;
            suggestFirstDeliveryKey(allItems);
            fillFilterOptions(result.repositories || [], result.schemas || []);
            applyFilters();
        });
    }

    loadContentListFn = loadContentList;

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
        var testBtn = document.getElementById('acc-cms-test-btn');
        var prevBtn = document.getElementById('acc-cms-prev');
        var nextBtn = document.getElementById('acc-cms-next');
        var loadBtn = document.getElementById('acc-cms-load-btn');
        var fetchBtn = document.getElementById('acc-cms-fetch-btn');
        var exportBtn = document.getElementById('acc-cms-export-btn');
        var previewAllBtn = document.getElementById('acc-cms-preview-all-btn');
        var exportLibraryBtn = document.getElementById('acc-cms-export-library-btn');
        var connStatus = document.getElementById('acc-cms-conn-status');
        var defaultKeyInput = document.getElementById('cms-defaultDeliveryKey');
        var deliveryKeyInput = document.getElementById('acc-cms-delivery-key');
        var filterRepo = document.getElementById('acc-cms-filter-repo');
        var filterSchema = document.getElementById('acc-cms-filter-schema');
        var filterSearch = document.getElementById('acc-cms-filter-search');

        if (deliveryKeyInput && !String(deliveryKeyInput.value || '').trim()) {
            if (defaultKeyInput && defaultKeyInput.value) {
                deliveryKeyInput.value = defaultKeyInput.value;
            } else if (cfg.defaultDeliveryKey) {
                deliveryKeyInput.value = cfg.defaultDeliveryKey;
            }
        }

        connected = cfg.connected;
        showStep(connected && cfg.initialStep > 1 ? cfg.initialStep : 1);
        if (connected) {
            setStatus(connStatus, 'Connected session active', false);
        }
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

        if (testBtn) {
            testBtn.addEventListener('click', function () {
                var params = 'platformId=' + encodeURIComponent(cfg.platformId);
                setStatus(connStatus, 'Testing credentials from Site Preferences...', false);
                post(cfg.testConnectionUrl, params, function (data) {
                    if (!data.ok) {
                        connected = false;
                        updateFooter(currentStep);
                        setStatus(connStatus, data.error || 'Connection failed', true);
                        return;
                    }
                    connected = true;
                    updateFooter(currentStep);
                    syncDeliveryKeyToStep2();
                    var name = (data.project && (data.project.name || data.project.key)) || 'Connected';
                    setStatus(connStatus, 'Connected to ' + name, false);
                }, 'connect');
            });
        }

        if (loadBtn) {
            loadBtn.addEventListener('click', function () {
                if (loadContentListFn) loadContentListFn(cfg, true);
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
        if (previewAllBtn) {
            previewAllBtn.addEventListener('click', function () {
                previewLibrary(cfg);
            });
        }
        if (exportLibraryBtn) {
            exportLibraryBtn.addEventListener('click', function () {
                exportLibrary(cfg);
            });
        }
        var resyncMigratedBtn = document.getElementById('acc-cms-resync-migrated-btn');
        if (resyncMigratedBtn) {
            resyncMigratedBtn.addEventListener('click', function () {
                resyncMigratedFolder(cfg);
            });
        }

        document.addEventListener('change', function (event) {
            var select = event.target;
            if (!select || !select.classList || !select.classList.contains('cms-locale-select')) {
                return;
            }
            var row = select.closest('.cms-preview-fields__row--localized');
            if (!row) return;
            var panels = row.querySelectorAll('.cms-locale-panel');
            var index = String(select.value);
            var pi;
            for (pi = 0; pi < panels.length; pi++) {
                if (String(panels[pi].getAttribute('data-locale-index')) === index) {
                    panels[pi].classList.remove('cms-locale-panel--hidden');
                } else {
                    panels[pi].classList.add('cms-locale-panel--hidden');
                }
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
