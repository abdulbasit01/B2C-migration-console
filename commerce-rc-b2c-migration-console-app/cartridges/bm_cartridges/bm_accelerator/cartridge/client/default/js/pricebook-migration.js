/**
 * Pricebook migration — standalone + embedded product prices from source platform.
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
        var root = document.getElementById('acc-pb-root');
        if (!root) return { ui: {} };
        return {
            countUrl:           root.getAttribute('data-count-url') || '',
            fullBatchUrl:       root.getAttribute('data-full-batch-url') || '',
            pricebooksUrl:      root.getAttribute('data-pricebooks-url') || '',
            checkAttrsUrl:      root.getAttribute('data-check-attrs-url') || '',
            createAttrsUrl:     root.getAttribute('data-create-attrs-url') || '',
            clearAttrMapUrl:    root.getAttribute('data-clear-attr-map-url') || '',
            dataWizardEntryUrl: root.getAttribute('data-wizard-entry-url') || '',
            impexPath:          root.getAttribute('data-impex-path') || '',
            presetPricebookId:  root.getAttribute('data-preset-pricebook-id') || '',
            ui:                 readUi(root)
        };
    }

    var SECTIONS = [
        {
            source:      'standalone',
            tbodyId:     'acc-pb-standalone-tbody',
            loadingId:   'acc-pb-standalone-loading',
            errorId:     'acc-pb-standalone-error',
            tableWrapId: 'acc-pb-standalone-table-wrap',
            summaryId:   'acc-pb-standalone-summary',
            selectAllId: 'acc-pb-standalone-select-all',
            reloadBtnId: 'acc-reload-standalone-btn',
            cbClass:     'acc-pb-standalone-cb',
            idClass:     'acc-pb-standalone-id',
            countClass:  'acc-pb-standalone-count',
            idPrefix:    ''
        },
        {
            source:      'embedded',
            tbodyId:     'acc-pb-embedded-tbody',
            loadingId:   'acc-pb-embedded-loading',
            errorId:     'acc-pb-embedded-error',
            tableWrapId: 'acc-pb-embedded-table-wrap',
            summaryId:   'acc-pb-embedded-summary',
            selectAllId: 'acc-pb-embedded-select-all',
            reloadBtnId: 'acc-reload-embedded-btn',
            cbClass:     'acc-pb-embedded-cb',
            idClass:     'acc-pb-embedded-id',
            countClass:  'acc-pb-embedded-count',
            idPrefix:    'product-'
        }
    ];

    function escHtml(val) {
        if (val === null || val === undefined) return '';
        return String(val)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function appendSectionUrl(baseUrl, section) {
        var url = baseUrl;
        var sep = url.indexOf('?') >= 0 ? '&' : '?';
        return url + sep + 'section=' + encodeURIComponent(section);
    }

    function discoveryUrl(baseUrl, section, offset, reset) {
        var url = appendSectionUrl(baseUrl, section);
        url += '&offset=' + (offset || 0);
        if (reset) {
            url += '&reset=true';
        }
        return url;
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

    function isValidPricebookId(id) {
        var i;
        var c;
        if (!id) return false;
        for (i = 0; i < id.length; i++) {
            c = id.charAt(i);
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === '-') {
                continue;
            }
            return false;
        }
        return true;
    }

    function sanitizeKey(key) {
        return String(key || 'channel').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    }

    function todayStamp() {
        var d = new Date();
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate());
    }

    function defaultPricebookId(base, pb, idPrefix) {
        var b = (idPrefix || '') + (base || 'list-prices').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        var cur = (pb.currency || 'USD').toLowerCase();
        if (pb.aggregate) {
            return b + '-' + cur;
        }
        var suffix = sanitizeKey(pb.channelKey || pb.channelId || 'channel');
        return b + '-' + cur + '-' + suffix;
    }

    function defaultFileName(exportKey) {
        var stamp = todayStamp();
        var key = String(exportKey || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        return 'pricebook-' + key + '-' + stamp + '-v001.xml';
    }

    function appendTargetParams(baseUrl, source, currency, channelId, aggregate) {
        var url = baseUrl;
        var sep = url.indexOf('?') >= 0 ? '&' : '?';
        url += sep + 'source=' + encodeURIComponent(source || 'standalone');
        url += '&currency=' + encodeURIComponent(currency || '');
        url += '&channelId=' + encodeURIComponent(channelId || 'all');
        url += '&aggregate=' + (aggregate ? 'true' : 'false');
        return url;
    }

    function boot() {
        var cfg = readCfg();
        var ui  = cfg.ui || {};
        var clearAttrMapOnLeave = (window.AccAttrPreflight && window.AccAttrPreflight.bindClearOnLeave)
            ? window.AccAttrPreflight.bindClearOnLeave(cfg.clearAttrMapUrl, 'Accelerator-PricebookMigration')
            : null;
        var pbSelectionErr = document.getElementById('acc-pb-selection-error');
        var startBtn = document.getElementById('full-start-btn');
        var fullOverallEl = document.getElementById('full-move-overall');
        var fullPhaseList = document.getElementById('full-phase-list');
        var checkAttrsBtn = document.getElementById('acc-check-attrs-btn');
        var attrCheckMsg = document.getElementById('acc-attr-check-msg');
        var attrResults = document.getElementById('acc-attr-results');

        var pendingMissing = [];
        var pendingMapped = [];
        var pendingCoverage = [];
        var pendingSkipped = [];
        var fullBuilt = 0;
        var fullFailed = 0;
        var fullFiles = 0;
        var fullRunning = false;
        var fullFinished = false;
        var exportQueue = [];
        var currentExportIdx = 0;
        var uploadedFiles = [];
        var cachedData = { standalone: [], embedded: [], productTotal: 0 };

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

        function getSectionDef(source) {
            var i;
            for (i = 0; i < SECTIONS.length; i++) {
                if (SECTIONS[i].source === source) return SECTIONS[i];
            }
            return null;
        }

        function updateSectionSummary(sec) {
            var summaryEl = document.getElementById(sec.summaryId);
            if (!summaryEl) return;
            var rows = document.querySelectorAll('.' + sec.cbClass + ':checked');
            summaryEl.textContent = rows.length ? rows.length + ' selected' : 'None selected';
            summaryEl.style.color = rows.length ? '#2e7d32' : '#54698d';
        }

        function buildExportRow(sec, pb, checked) {
            var tr = document.createElement('tr');
            tr.setAttribute('data-export-key', pb.exportKey);
            tr.setAttribute('data-source', sec.source);
            tr.setAttribute('data-currency', pb.currency);
            tr.setAttribute('data-channel-id', pb.channelId || 'all');
            tr.setAttribute('data-aggregate', pb.aggregate ? 'true' : 'false');
            tr.innerHTML = ''
                + '<td style="text-align:center;"><input type="checkbox" class="' + sec.cbClass
                + '" data-export-key="' + escHtml(pb.exportKey) + '"' + (checked ? ' checked' : '') + '/></td>'
                + '<td><strong>' + escHtml(pb.label) + '</strong>'
                + (pb.subLabel ? '<br/><span style="font-size:11px;color:#8a9ab8;">' + escHtml(pb.subLabel) + '</span>' : '')
                + '</td>'
                + '<td><input type="text" class="pb-id-input ' + sec.idClass + '" data-export-key="' + escHtml(pb.exportKey)
                + '" value="' + escHtml(pb.pricebookId) + '"/></td>'
                + '<td><code class="pb-file-name">' + escHtml(pb.fileName) + '</code></td>'
                + '<td class="pb-count-cell ' + sec.countClass + '" data-export-key="' + escHtml(pb.exportKey) + '">'
                + (pb.priceCount != null ? pb.priceCount.toLocaleString() : '&mdash;') + '</td>';
            return tr;
        }

        function renderSectionTable(sec, pricebooks) {
            var tbody = document.getElementById(sec.tbodyId);
            var loading = document.getElementById(sec.loadingId);
            var errorEl = document.getElementById(sec.errorId);
            var tableWrap = document.getElementById(sec.tableWrapId);
            var base = cfg.presetPricebookId || 'list-prices';
            var i;

            if (!tbody) return;
            tbody.innerHTML = '';

            if (!pricebooks || !pricebooks.length) {
                if (loading) loading.style.display = 'none';
                if (errorEl) {
                    errorEl.style.display = 'block';
                    errorEl.textContent = sec.source === 'embedded'
                        ? (ui.pbNoEmbedded || 'No embedded prices found.')
                        : (ui.pbNoStandalone || 'No standalone prices found.');
                }
                updateSectionSummary(sec);
                return;
            }

            for (i = 0; i < pricebooks.length; i++) {
                var pb = pricebooks[i];
                pb.pricebookId = defaultPricebookId(base, pb, sec.idPrefix);
                pb.fileName = defaultFileName(pb.exportKey);
                tbody.appendChild(buildExportRow(sec, pb, i === 0 && sec.source === 'standalone'));
            }

            if (loading) loading.style.display = 'none';
            if (tableWrap) tableWrap.style.display = 'block';
            if (errorEl) errorEl.style.display = 'none';
            updateSectionSummary(sec);

            var cbs = document.querySelectorAll('.' + sec.cbClass);
            var c;
            for (c = 0; c < cbs.length; c++) {
                cbs[c].addEventListener('change', function () {
                    updateSectionSummary(sec);
                });
            }
        }

        function loadSection(sec, fromUserClick) {
            if (!cfg.pricebooksUrl) {
                var errEl0 = document.getElementById(sec.errorId);
                var loadEl0 = document.getElementById(sec.loadingId);
                if (loadEl0) loadEl0.style.display = 'none';
                if (errEl0) {
                    errEl0.style.display = 'block';
                    errEl0.textContent = 'Pricebooks API URL is missing. Hard-refresh the page (Ctrl+Shift+R).';
                }
                return;
            }

            var loading = document.getElementById(sec.loadingId);
            var errorEl = document.getElementById(sec.errorId);
            var tableWrap = document.getElementById(sec.tableWrapId);
            var reloadBtn = document.getElementById(sec.reloadBtnId);

            if (loading) {
                loading.style.display = 'block';
                loading.textContent = fromUserClick ? 'Rescanning...' : 'Scanning...';
            }
            if (errorEl) errorEl.style.display = 'none';
            if (tableWrap) tableWrap.style.display = 'none';
            if (reloadBtn) {
                reloadBtn.disabled = true;
                reloadBtn.textContent = 'Loading...';
            }

            function pollDiscovery(offset, reset) {
                get(discoveryUrl(cfg.pricebooksUrl, sec.source, offset, reset), function (data) {
                    if (!data.ok) {
                        if (reloadBtn) {
                            reloadBtn.disabled = false;
                            reloadBtn.textContent = sec.reloadBtnId === 'acc-reload-standalone-btn'
                                ? 'Reload Standalone' : 'Reload Embedded';
                        }
                        if (loading) loading.style.display = 'none';
                        if (errorEl) {
                            errorEl.style.display = 'block';
                            errorEl.textContent = 'Failed to load: ' + (data.error || 'Unknown error');
                        }
                        return;
                    }

                    if (loading) {
                        var scanned = data.scanned || 0;
                        var total   = data.total != null ? data.total : '?';
                        var unit    = sec.source === 'embedded' ? 'products' : 'prices';
                        loading.textContent = 'Scanning ' + scanned + ' / ' + total + ' ' + unit + '...';
                    }

                    if (!data.done) {
                        pollDiscovery(data.nextOffset || 0, false);
                        return;
                    }

                    if (reloadBtn) {
                        reloadBtn.disabled = false;
                        reloadBtn.textContent = sec.reloadBtnId === 'acc-reload-standalone-btn'
                            ? 'Reload Standalone' : 'Reload Embedded';
                    }

                    if (sec.source === 'embedded') {
                        cachedData.productTotal = data.productTotal || data.total || 0;
                        cachedData.embedded = data.embedded || [];
                        renderSectionTable(sec, cachedData.embedded);
                        return;
                    }

                    cachedData.standalone = data.standalone || [];
                    renderSectionTable(sec, cachedData.standalone);
                });
            }

            pollDiscovery(0, !!fromUserClick);
        }

        function loadAllPricebooks(fromUserClick, sourceFilter) {
            var si;
            for (si = 0; si < SECTIONS.length; si++) {
                if (sourceFilter && SECTIONS[si].source !== sourceFilter) continue;
                loadSection(SECTIONS[si], fromUserClick);
            }
        }

        function fetchRowCount(sec, cell) {
            if (!cell) return;
            var exportKey = cell.getAttribute('data-export-key');
            var tr = document.querySelector('tr[data-export-key="' + exportKey + '"][data-source="' + sec.source + '"]');
            if (!tr) return;
            var currency = tr.getAttribute('data-currency') || '';
            var channelId = tr.getAttribute('data-channel-id') || 'all';
            var aggregate = tr.getAttribute('data-aggregate') === 'true';
            cell.textContent = '...';
            get(appendTargetParams(cfg.countUrl, sec.source, currency, channelId, aggregate), function (data) {
                cell.textContent = data.ok ? data.total.toLocaleString() : 'Error';
                cell.style.color = data.ok ? '#54698d' : '#c62828';
            });
        }

        function readExportFromRow(sec, exportKey) {
            var cb = document.querySelector('.' + sec.cbClass + '[data-export-key="' + exportKey + '"]');
            if (!cb || !cb.checked) return null;

            var tr = document.querySelector('tr[data-export-key="' + exportKey + '"][data-source="' + sec.source + '"]');
            var idInput = document.querySelector('.' + sec.idClass + '[data-export-key="' + exportKey + '"]');
            var labelEl = tr ? tr.querySelector('td strong') : null;

            return {
                source:      sec.source,
                exportKey:   exportKey,
                label:       labelEl ? labelEl.textContent : exportKey,
                pricebookId: idInput ? idInput.value.trim() : '',
                fileName:    defaultFileName(exportKey),
                currency:    tr ? tr.getAttribute('data-currency') : '',
                channelId:   tr ? tr.getAttribute('data-channel-id') : 'all',
                aggregate:   tr ? tr.getAttribute('data-aggregate') === 'true' : false
            };
        }

        function getSelectedExports() {
            var out = [];
            var si;
            for (si = 0; si < SECTIONS.length; si++) {
                var sec = SECTIONS[si];
                var keys = document.querySelectorAll('.' + sec.cbClass + ':checked');
                var i;
                for (i = 0; i < keys.length; i++) {
                    var item = readExportFromRow(sec, keys[i].getAttribute('data-export-key'));
                    if (item) out.push(item);
                }
            }
            return out;
        }

        function validateExports(exports) {
            if (!exports.length) {
                if (pbSelectionErr) {
                    pbSelectionErr.textContent = 'Select at least one pricebook from either section.';
                    pbSelectionErr.style.display = 'block';
                }
                return false;
            }
            if (pbSelectionErr) pbSelectionErr.style.display = 'none';

            var i;
            for (i = 0; i < exports.length; i++) {
                var ex = exports[i];
                if (!isValidPricebookId(ex.pricebookId)) {
                    if (pbSelectionErr) {
                        pbSelectionErr.textContent = 'Invalid SFCC pricebook ID for "' + ex.label
                            + '". Use letters, numbers, underscore, or hyphen.';
                        pbSelectionErr.style.display = 'block';
                    }
                    return false;
                }
            }
            return true;
        }

        function finalizeFull(success) {
            fullRunning = false;
            if (startBtn) startBtn.disabled = false;
            if (success) {
                fullFinished = true;
                if (startBtn) startBtn.textContent = 'Finish';
                var importDetail = fullFiles + ' file(s) uploaded to /Impex/' + cfg.impexPath + '/';
                if (uploadedFiles.length) {
                    importDetail += ' Files: ' + uploadedFiles.join(', ') + '.';
                }
                importDetail += ' Import pricebooks in Business Manager.';
                setPhase('full', 'import', 'active', importDetail, null);
            } else {
                fullFinished = false;
                if (startBtn) startBtn.textContent = 'Start Migration (Build XML)';
            }
        }

        function progressLabel(target, offset, total) {
            var unit = target.source === 'embedded' ? 'products' : 'prices';
            return 'Pricebook ' + (currentExportIdx + 1) + '/' + exportQueue.length
                + ' — ' + target.label + ': ' + offset + ' / ' + (total || '?') + ' ' + unit;
        }

        function runFullBatchForTarget(target, offset, total) {
            var pct = (total > 0) ? Math.round((offset / total) * 100) : 0;
            setPhase('full', 'build', 'active', progressLabel(target, offset, total), pct);

            post(
                cfg.fullBatchUrl,
                'offset=' + offset
                + '&source=' + encodeURIComponent(target.source)
                + '&pricebookId=' + encodeURIComponent(target.pricebookId)
                + '&currency=' + encodeURIComponent(target.currency)
                + '&channelId=' + encodeURIComponent(target.channelId)
                + '&exportKey=' + encodeURIComponent(target.exportKey)
                + '&fileName=' + encodeURIComponent(target.fileName)
                + '&aggregate=' + (target.aggregate ? 'true' : 'false')
                + '&singleFile=true',
                function (data) {
                    if (!data.ok) {
                        setPhase('full', 'build', 'error', data.error || 'Failed', pct);
                        if (fullOverallEl) {
                            fullOverallEl.textContent = 'Error on "' + target.label + '": ' + (data.error || 'Failed');
                        }
                        finalizeFull(false);
                        return;
                    }
                    fullBuilt  += (data.built  || 0);
                    fullFailed += (data.failed || 0);
                    if (data.fileName) {
                        fullFiles++;
                        if (uploadedFiles.indexOf(data.fileName) < 0) {
                            uploadedFiles.push(data.fileName);
                        }
                    }
                    if (fullOverallEl) {
                        fullOverallEl.textContent = 'Export ' + (currentExportIdx + 1) + '/' + exportQueue.length
                            + ' — ' + fullFiles + ' file(s), ' + fullBuilt + ' price(s)';
                    }
                    if (!data.done && data.singleFile !== true) {
                        runFullBatchForTarget(target, data.nextOffset, data.total);
                    } else {
                        currentExportIdx++;
                        runNextExport();
                    }
                }
            );
        }

        function runNextExport() {
            if (currentExportIdx >= exportQueue.length) {
                setPhase('full', 'build', fullFailed ? 'warning' : 'done', fullFiles + ' file(s) uploaded', 100);
                finalizeFull(true);
                return;
            }
            var target = exportQueue[currentExportIdx];
            if (target.source === 'embedded') {
                runFullBatchForTarget(target, 0, cachedData.productTotal);
                return;
            }
            get(appendTargetParams(cfg.countUrl, target.source, target.currency, target.channelId, target.aggregate), function (countData) {
                var total = countData.ok ? countData.total : 0;
                if (!countData.ok && fullOverallEl) {
                    fullOverallEl.textContent = 'Count failed for "' + target.label + '" — starting anyway';
                }
                runFullBatchForTarget(target, 0, total);
            });
        }

        function beginMigration() {
            exportQueue = getSelectedExports();
            if (!validateExports(exportQueue)) {
                if (startBtn) startBtn.disabled = false;
                return;
            }

            fullRunning = true;
            fullBuilt = 0;
            fullFailed = 0;
            fullFiles = 0;
            uploadedFiles = [];
            currentExportIdx = 0;

            if (startBtn) startBtn.textContent = 'Building...';
            if (fullPhaseList) fullPhaseList.style.display = 'block';
            setPhase('full', 'build', 'pending', '', 0);
            setPhase('full', 'import', 'pending', null, 0);
            runNextExport();
        }

        function renderAttrResults(missing, mapped, coveragePending, skipped, suggested, aiMeta) {
            if (!attrResults) return;
            if (!window.AccAttrPreflight || !window.AccAttrPreflight.renderMissingResults) {
                attrResults.innerHTML = '<p style="color:#c62828;font-size:13px;margin:0;">Attribute helper script failed to load.</p>';
                attrResults.style.display = 'block';
                return;
            }
            // When nothing was actually checked (e.g. SAP has no field-discovery endpoint),
            // override the "all exist" message so it doesn't imply a verified match.
            var effectiveUi = ui;
            if (aiMeta && aiMeta.noDynamicFieldSource && !(missing && missing.length)) {
                effectiveUi = Object.assign({}, ui, { allAttrsExist: ui.pbAttrsNoSource || ui.allAttrsExist });
            }
            window.AccAttrPreflight.renderMissingResults({
                container:       attrResults,
                mapped:          mapped || [],
                coveragePending: coveragePending || [],
                skipped:         skipped || [],
                suggested:       suggested || [],
                aiStatus:        (aiMeta && aiMeta.aiStatus) || 'skipped',
                aiMessage:       (aiMeta && aiMeta.aiMessage) || '',
                suggestAttrMapsUrl: (aiMeta && aiMeta.suggestAttrMapsUrl) || '',
                taskName:           (aiMeta && aiMeta.taskName) || '',
                sfccObjectType:     (aiMeta && aiMeta.sfccObjectType) || '',
                sessionSystemMaps: (aiMeta && aiMeta.sessionSystemMaps) || [],
                missing:         missing,
                ui:              effectiveUi,
                createAttrsUrl:  cfg.createAttrsUrl,
                clearAttrMapUrl: cfg.clearAttrMapUrl || '',
                post:            post,
                getPending:      function () { return pendingMissing; }
            });
        }

        var si;
        for (si = 0; si < SECTIONS.length; si++) {
            (function (sec) {
                var selectAll = document.getElementById(sec.selectAllId);
                var reloadBtn = document.getElementById(sec.reloadBtnId);
                var loadingEl = document.getElementById(sec.loadingId);
                var tableWrap = document.getElementById(sec.tableWrapId);

                if (loadingEl) {
                    loadingEl.style.display = 'block';
                    loadingEl.textContent = sec.source === 'embedded'
                        ? (ui.pbEmbeddedLoading || 'Click Load Embedded to scan products.')
                        : (ui.pbStandaloneLoading || 'Click Load Standalone to scan prices.');
                }
                if (tableWrap) tableWrap.style.display = 'none';

                if (selectAll) {
                    selectAll.addEventListener('change', function () {
                        var cbs = document.querySelectorAll('.' + sec.cbClass);
                        var i;
                        for (i = 0; i < cbs.length; i++) cbs[i].checked = this.checked;
                        updateSectionSummary(sec);
                    });
                }
                if (reloadBtn) {
                    reloadBtn.addEventListener('click', function () {
                        loadAllPricebooks(true, sec.source);
                    });
                }
            }(SECTIONS[si]));
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
                    pendingMapped = data.mapped || [];
                    pendingCoverage = data.coveragePending || [];
                    pendingSkipped = data.skipped || [];
                    pendingMissing = data.missing || [];
                    if (attrCheckMsg) {
                        var parts = [];
                        if (pendingMapped.length) parts.push(pendingMapped.length + ' mapped');
                        if (pendingMissing.length) parts.push(pendingMissing.length + (ui.attrsMissingBrief || ' to create.'));
                        if (parts.length) {
                            attrCheckMsg.textContent = parts.join(', ');
                            attrCheckMsg.style.color = pendingMissing.length ? '#e65100' : '#2e7d32';
                        } else if (data.noDynamicFieldSource) {
                            attrCheckMsg.textContent = ui.pbAttrsNoSource || 'Nothing to check.';
                            attrCheckMsg.style.color = '#8a9ab8';
                        } else {
                            attrCheckMsg.textContent = ui.attrsAllInSync || 'All in sync.';
                            attrCheckMsg.style.color = '#2e7d32';
                        }
                    }
                    renderAttrResults(pendingMissing, pendingMapped, pendingCoverage, pendingSkipped, data.suggested || [], data);
                });
            });
        }

        if (startBtn) {
            startBtn.addEventListener('click', function () {
                if (fullFinished) {
                    if (clearAttrMapOnLeave) clearAttrMapOnLeave();
                    window.location.href = cfg.dataWizardEntryUrl;
                    return;
                }
                if (fullRunning) return;
                fullFinished = false;
                startBtn.disabled = true;
                beginMigration();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
}());
