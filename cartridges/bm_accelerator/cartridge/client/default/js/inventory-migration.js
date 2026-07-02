/**
 * Inventory list migration — multi-channel export with editable list IDs.
 */
(function () {
    'use strict';

    var loadChannelsHandler = null; // reserved for extension hooks

    function readCfg() {
        var panel = document.getElementById('acc-inv-details');
        if (!panel) return {};
        return {
            countUrl:           panel.getAttribute('data-count-url') || '',
            fullBatchUrl:       panel.getAttribute('data-full-batch-url') || '',
            channelsUrl:        panel.getAttribute('data-channels-url') || '',
            checkAttrsUrl:      panel.getAttribute('data-check-attrs-url') || '',
            createAttrsUrl:     panel.getAttribute('data-create-attrs-url') || '',
            dataWizardEntryUrl: panel.getAttribute('data-wizard-entry-url') || '',
            impexPath:          panel.getAttribute('data-impex-path') || '',
            presetListId:       panel.getAttribute('data-preset-list-id') || ''
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

    function isValidListId(id) {
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

    function defaultListId(base, suffix) {
        var b = (base || 'inventory').replace(/[^a-zA-Z0-9_-]/g, '_');
        return b + '_' + suffix;
    }

    function defaultFileName(exportKey) {
        var stamp = todayStamp();
        if (exportKey === 'aggregated') {
            return 'inventory-aggregated-' + stamp + '-v001.xml';
        }
        var key = String(exportKey || '').replace(/^ch_/, '');
        return 'inventory-' + key + '-' + stamp + '-v001.xml';
    }

    function appendChannelParam(baseUrl, channelId) {
        if (!channelId || channelId === 'all') return baseUrl;
        return baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?')
            + 'supplyChannelId=' + encodeURIComponent(channelId);
    }

    function boot() {
        var cfg = readCfg();

        var invTbody          = document.getElementById('acc-inv-tbody');
        var invLoading        = document.getElementById('acc-inv-loading');
        var invError          = document.getElementById('acc-inv-error');
        var invTableWrap      = document.getElementById('acc-inv-table-wrap');
        var invSummary        = document.getElementById('acc-inv-summary');
        var invSelectAll      = document.getElementById('acc-inv-select-all');
        var invSelectionErr   = document.getElementById('acc-inv-selection-error');
        var reloadChannelsBtn = document.getElementById('acc-reload-channels-btn');
        var startBtn          = document.getElementById('full-start-btn');
        var fullOverallEl     = document.getElementById('full-move-overall');
        var fullPhaseList     = document.getElementById('full-phase-list');
        var checkAttrsBtn     = document.getElementById('acc-check-attrs-btn');
        var attrCheckMsg      = document.getElementById('acc-attr-check-msg');
        var attrResults       = document.getElementById('acc-attr-results');
        var preflightModal    = document.getElementById('acc-preflight-modal');
        var modalAttrList     = document.getElementById('acc-modal-attr-list');
        var modalSkipBtn      = document.getElementById('acc-modal-skip');
        var modalCreateBtn    = document.getElementById('acc-modal-create');

        var pendingMissing = [];
        var fullBuilt = 0;
        var fullFailed = 0;
        var fullFiles = 0;
        var fullRunning = false;
        var fullFinished = false;
        var lastUploadedFile = '';
        var modalCallback = null;
        var exportQueue = [];
        var currentExportIdx = 0;
        var uploadedFiles = [];

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

        function updateSelectionSummary() {
            if (!invSummary) return;
            var rows = document.querySelectorAll('.acc-inv-export-cb:checked');
            invSummary.textContent = rows.length ? rows.length + ' file(s) selected' : 'No files selected';
            invSummary.style.color = rows.length ? '#2e7d32' : '#e65100';
        }

        function buildExportRow(opts) {
            var rowKey = opts.exportKey;
            var tr = document.createElement('tr');
            tr.setAttribute('data-export-key', rowKey);
            tr.innerHTML = ''
                + '<td style="text-align:center;"><input type="checkbox" class="acc-inv-export-cb" data-export-key="'
                + escHtml(rowKey) + '"' + (opts.checked ? ' checked' : '') + '/></td>'
                + '<td><strong>' + escHtml(opts.label) + '</strong>'
                + (opts.subLabel ? '<br/><span style="font-size:11px;color:#8a9ab8;">' + escHtml(opts.subLabel) + '</span>' : '')
                + '</td>'
                + '<td><input type="text" class="inv-list-input acc-inv-list-id" data-export-key="' + escHtml(rowKey)
                + '" value="' + escHtml(opts.listId) + '"/></td>'
                + '<td><code class="inv-file-name">' + escHtml(opts.fileName) + '</code></td>'
                + '<td class="inv-count-cell acc-inv-count" data-export-key="' + escHtml(rowKey) + '" data-channel-id="'
                + escHtml(opts.channelId || 'all') + '">&mdash;</td>';
            return tr;
        }

        function loadEntryCounts() {
            var cells = document.querySelectorAll('.acc-inv-count');
            var i;

            for (i = 0; i < cells.length; i++) {
                (function (cell) {
                    var channelId = cell.getAttribute('data-channel-id') || 'all';
                    cell.textContent = 'Loading...';
                    cell.style.color = '#8a9ab8';

                    get(appendChannelParam(cfg.countUrl, channelId), function (data) {
                        if (data.ok && typeof data.total === 'number') {
                            cell.textContent = String(data.total);
                            cell.style.color = data.total > 0 ? '#16325c' : '#e65100';
                        } else {
                            cell.textContent = '—';
                            cell.style.color = '#c62828';
                        }
                        updateCountSummary();
                    });
                })(cells[i]);
            }
        }

        function updateCountSummary() {
            if (!invSummary) return;
            var cells = document.querySelectorAll('.acc-inv-count');
            var totalEntries = 0;
            var loaded = 0;
            var i;

            for (i = 0; i < cells.length; i++) {
                var text = cells[i].textContent;
                if (text === 'Loading...' || text === '\u2014' || text === '—') continue;
                var n = parseInt(text, 10);
                if (!isNaN(n)) {
                    loaded++;
                    if (cells[i].getAttribute('data-export-key') === 'aggregated') {
                        totalEntries = n;
                    }
                }
            }

            var selected = document.querySelectorAll('.acc-inv-export-cb:checked').length;
            if (loaded && totalEntries > 0) {
                invSummary.textContent = totalEntries + ' total CTP entries'
                    + (selected ? ' — ' + selected + ' file(s) selected' : '');
                invSummary.style.color = '#2e7d32';
            } else {
                updateSelectionSummary();
            }
        }

        function renderExportTable(channels) {
            if (!invTbody) return;
            invTbody.innerHTML = '';
            var base = cfg.presetListId || 'inventory';

            invTbody.appendChild(buildExportRow({
                exportKey:  'aggregated',
                label:      'Aggregated (all channels)',
                subLabel:   'Sums stock per SKU across all supply channels',
                listId:     defaultListId(base, 'aggregated'),
                fileName:   defaultFileName('aggregated'),
                channelId:  'all',
                checked:    true
            }));

            var i;
            for (i = 0; i < channels.length; i++) {
                var ch = channels[i];
                var key = sanitizeKey(ch.key || ch.id);
                invTbody.appendChild(buildExportRow({
                    exportKey:  'ch_' + key,
                    label:      ch.name || ch.key,
                    subLabel:   'Channel key: ' + (ch.key || ch.id),
                    listId:     defaultListId(base, key),
                    fileName:   defaultFileName('ch_' + key),
                    channelId:  ch.id,
                    checked:    false
                }));
            }

            if (invLoading) invLoading.style.display = 'none';
            if (invTableWrap) invTableWrap.style.display = 'block';
            if (invError) invError.style.display = 'none';
            updateSelectionSummary();

            if (invSummary && !channels.length) {
                invSummary.textContent = 'No CTP supply channels found — aggregated export only';
                invSummary.style.color = '#e65100';
            }

            var cbs = document.querySelectorAll('.acc-inv-export-cb');
            var c;
            for (c = 0; c < cbs.length; c++) {
                cbs[c].addEventListener('change', function () {
                    updateSelectionSummary();
                    updateCountSummary();
                });
            }

            loadEntryCounts();
        }

        function loadChannels(fromUserClick) {
            if (!cfg.channelsUrl) {
                if (invLoading) invLoading.style.display = 'none';
                if (invError) {
                    invError.style.display = 'block';
                    invError.textContent = 'Channels API URL is missing. Hard-refresh the page (Ctrl+Shift+R).';
                }
                return;
            }

            if (invLoading) {
                invLoading.style.display = 'block';
                invLoading.textContent = fromUserClick
                    ? 'Reloading supply channels from commercetools...'
                    : 'Loading supply channels from commercetools...';
            }
            if (invError) invError.style.display = 'none';
            if (invTableWrap) invTableWrap.style.display = 'none';
            if (reloadChannelsBtn) {
                reloadChannelsBtn.disabled = true;
                reloadChannelsBtn.textContent = 'Loading...';
            }

            get(cfg.channelsUrl, function (data) {
                if (reloadChannelsBtn) {
                    reloadChannelsBtn.disabled = false;
                    reloadChannelsBtn.textContent = 'Reload Channels';
                }

                if (!data.ok) {
                    if (invLoading) invLoading.style.display = 'none';
                    if (invError) {
                        invError.style.display = 'block';
                        invError.textContent = 'Failed to load channels: ' + (data.error || 'Unknown error');
                    }
                    return;
                }

                if (!data.channels) {
                    if (invLoading) invLoading.style.display = 'none';
                    if (invError) {
                        invError.style.display = 'block';
                        invError.textContent = 'Unexpected response from channels API.';
                    }
                    return;
                }

                renderExportTable(data.channels);
            });
        }

        if (reloadChannelsBtn) {
            reloadChannelsBtn.addEventListener('click', function (e) {
                e.preventDefault();
                loadChannels(true);
            });
        }

        if (invLoading) {
            invLoading.style.display = 'block';
            invLoading.textContent = 'Click Load Channels to fetch supply channels and CTP entry counts.';
        }
        if (invTableWrap) invTableWrap.style.display = 'none';

        loadChannelsHandler = loadChannels;

        function readExportFromRow(exportKey) {
            var cb = document.querySelector('.acc-inv-export-cb[data-export-key="' + exportKey + '"]');
            if (!cb || !cb.checked) return null;

            var listInput = document.querySelector('.acc-inv-list-id[data-export-key="' + exportKey + '"]');
            var countCell = document.querySelector('.acc-inv-count[data-export-key="' + exportKey + '"]');
            var channelId = countCell ? countCell.getAttribute('data-channel-id') : 'all';
            var tr = document.querySelector('tr[data-export-key="' + exportKey + '"]');
            var labelEl = tr ? tr.querySelector('td strong') : null;

            return {
                exportKey:       exportKey,
                label:           labelEl ? labelEl.textContent : exportKey,
                listId:          listInput ? listInput.value.trim() : '',
                fileName:        defaultFileName(exportKey),
                supplyChannelId: channelId,
                aggregate:       exportKey === 'aggregated'
            };
        }

        function getSelectedExports() {
            var keys = document.querySelectorAll('.acc-inv-export-cb:checked');
            var out = [];
            var i;
            for (i = 0; i < keys.length; i++) {
                var item = readExportFromRow(keys[i].getAttribute('data-export-key'));
                if (item) out.push(item);
            }
            return out;
        }

        function validateExports(exports) {
            if (!exports.length) {
                if (invSelectionErr) {
                    invSelectionErr.textContent = 'Select at least one inventory file to generate.';
                    invSelectionErr.style.display = 'block';
                }
                return false;
            }
            if (invSelectionErr) invSelectionErr.style.display = 'none';

            var i;
            for (i = 0; i < exports.length; i++) {
                var ex = exports[i];
                if (!isValidListId(ex.listId)) {
                    if (invSelectionErr) {
                        invSelectionErr.textContent = 'Invalid SFCC list ID for "' + ex.label
                            + '". Use letters, numbers, underscore, or hyphen.';
                        invSelectionErr.style.display = 'block';
                    }
                    return false;
                }
            }
            return true;
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
                importDetail += ' Import inventory lists in Business Manager.';
                setPhase('full', 'import', 'active', importDetail, null);
            } else {
                fullFinished = false;
                if (startBtn) startBtn.textContent = 'Start Migration (Build XML)';
            }
        }

        function runFullBatchForTarget(target, offset, total) {
            var pct = (total > 0) ? Math.round((offset / total) * 100) : 0;
            var phaseDetail = 'File ' + (currentExportIdx + 1) + '/' + exportQueue.length
                + ' — ' + target.label + ': '
                + (offset === 0 && total > 0
                    ? 'building single XML for ' + total + ' entries'
                    : offset + ' / ' + (total || '?') + ' entries');
            setPhase('full', 'build', 'active', phaseDetail, offset === 0 && total > 0 ? 50 : pct);

            post(
                cfg.fullBatchUrl,
                'offset=' + offset
                + '&listId=' + encodeURIComponent(target.listId)
                + '&supplyChannelId=' + encodeURIComponent(target.supplyChannelId)
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
                        lastUploadedFile = data.fileName;
                        if (uploadedFiles.indexOf(data.fileName) < 0) {
                            uploadedFiles.push(data.fileName);
                        }
                    }
                    if (fullOverallEl) {
                        fullOverallEl.textContent = 'Export ' + (currentExportIdx + 1) + '/' + exportQueue.length
                            + ' — ' + fullFiles + ' file(s), ' + fullBuilt + ' record(s)';
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
            get(appendChannelParam(cfg.countUrl, target.supplyChannelId), function (countData) {
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
            lastUploadedFile = '';

            if (startBtn) startBtn.textContent = 'Building...';
            if (fullPhaseList) fullPhaseList.style.display = 'block';
            setPhase('full', 'build', 'pending', '', 0);
            setPhase('full', 'import', 'pending', null, 0);
            runNextExport();
        }

        function renderAttrResults(missing) {
            if (!attrResults) return;
            attrResults.innerHTML = '';
            attrResults.style.display = 'block';
            if (!missing.length) {
                attrResults.innerHTML = '<p style="color:#2e7d32;font-size:13px;margin:0;">All CTP inventory attributes already exist in SFCC.</p>';
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

            var selectAll = document.getElementById('acc-attr-select-all');
            var createBtn = document.getElementById('acc-create-attrs-btn');
            if (selectAll) {
                selectAll.addEventListener('change', function () {
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
                    if (idInput && idInput.value.trim()) selected[selected.length - 1].id = idInput.value.trim();
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

        if (invSelectAll) {
            invSelectAll.addEventListener('change', function () {
                var cbs = document.querySelectorAll('.acc-inv-export-cb');
                var i;
                for (i = 0; i < cbs.length; i++) cbs[i].checked = this.checked;
                updateSelectionSummary();
                updateCountSummary();
            });
        }

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
                lastUploadedFile = '';
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
