var _APP = {};
_APP.MIGRATE_URL         = '';
_APP.FETCH_URL           = '';
_APP.ATTRS_URL           = '';
_APP.STATUS_URL          = '';
_APP.IMPEX_URL           = '';
_APP.FETCH_CATALOGS_URL  = '';
_APP.CREATE_CATALOG_URL  = '';
_APP.CREATE_CATEGORY_URL = '';
_APP.IMPORT_URL          = '';
_APP.allCategories      = [];
_APP.catMap             = {};
_APP.hierarchyOverrides = {};
_APP.orderOverrides     = {};
_APP.pendingParent      = {};
_APP.pendingOrder       = {};
_APP.running            = false;
_APP.draggingId         = null;
_APP.activeFilter       = 'all';

_APP.post = function (url, params, onDone) {
    var req = new XMLHttpRequest();
    req.open('POST', url, true);
    req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    req.onreadystatechange = function () {
        if (req.readyState !== 4) return;
        var raw = req.responseText || '';
        var start = raw.indexOf('{');
        if (start > 0) raw = raw.substring(start);
        var data;
        try { data = JSON.parse(raw); } catch (e) { data = { ok: false, error: 'Parse error' }; }
        onDone(data);
    };
    req.send(params);
};

_APP.openInNewTab = function (url) {
    var a = document.createElement('a');
    a.href = url; a.target = '_blank';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

_APP.toCamelCase = function (str) {
    if (!str) return '';
    return str.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
};

_APP.getCatalogId = function () {
    var el = document.getElementById('cat-catalog-id');
    return el ? el.value.trim() : '';
};

_APP.goToStep = function (n) {
    [1, 2, 3, 4, 5].forEach(function (i) {
        var p = document.getElementById('panel-step' + i);
        var t = document.getElementById('tab-' + i);
        if (p) p.style.display = (i === n) ? 'block' : 'none';
        if (t) { t.style.color = (i === n) ? '#0070d2' : '#54698d'; t.style.borderBottom = (i === n) ? '3px solid #0070d2' : '3px solid transparent'; }
    });
    if (n === 5) {
        var cid = _APP.getCatalogId();
        var disp = document.getElementById('new-cat-catalog-display');
        if (disp) { disp.textContent = cid ? 'Catalog: ' + cid : 'No catalog selected. Set Target Catalog ID in the config bar above.'; disp.style.color = cid ? '#16325c' : '#54698d'; }
    }
};

_APP.setPhase = function (id, state, detail, pct) {
    var li = document.getElementById('cat-phase-' + id);
    var st = document.getElementById('cat-status-' + id);
    var det = document.getElementById('cat-detail-' + id);
    var bar = document.getElementById('cat-bar-' + id);
    if (!li) return;
    li.className = 'acc-phases__item acc-phases__item--' + state;
    if (st) st.textContent = state;
    if (det) det.textContent = detail || '';
    if (bar) bar.style.width = (pct || 0) + '%';
};

_APP.effectiveParentId = function (catId) {
    if (_APP.pendingParent[catId] !== undefined) return _APP.pendingParent[catId];
    if (_APP.hierarchyOverrides[catId] !== undefined) return _APP.hierarchyOverrides[catId];
    var cat = _APP.catMap[catId];
    return cat ? (cat.parentId || 'root') : 'root';
};

_APP.getDepth = function (catId, visited) {
    visited = visited || {};
    if (visited[catId]) return 0;
    visited[catId] = true;
    var pId = _APP.effectiveParentId(catId);
    if (!pId || pId === 'root') return 0;
    return _APP.catMap[pId] ? 1 + _APP.getDepth(pId, visited) : 0;
};

_APP.isDescendant = function (catId, targetId) {
    if (!targetId || targetId === 'root') return false;
    var visited = {};
    var cur = targetId;
    while (cur && cur !== 'root') {
        if (visited[cur]) break;
        visited[cur] = true;
        if (cur === catId) return true;
        cur = _APP.effectiveParentId(cur);
    }
    return false;
};

_APP.getPosition = function (catId) {
    if (_APP.pendingOrder[catId] !== undefined) return _APP.pendingOrder[catId];
    if (_APP.orderOverrides[catId] !== undefined) return _APP.orderOverrides[catId];
    var cat = _APP.catMap[catId];
    return cat ? (cat.position || 0) : 0;
};

_APP.getLevelColor = function (depth) {
    var colors = ['#0070d2', '#5b5fc7', '#2e7d32', '#e65100'];
    return colors[depth] || '#78909c';
};

_APP.buildParentOptions = function (catId) {
    var html = '<option value="root">root (top level)</option>';
    _APP.allCategories.forEach(function (c) {
        if (c.id === catId) return;
        if (_APP.isDescendant(catId, c.id)) return;
        html += '<option value="' + c.id + '">' + c.id + '</option>';
    });
    return html;
};

_APP.buildSortedRows = function () {
    var result = []; var visited = {};
    function visitGroup(parentId) {
        var children = _APP.allCategories.filter(function (c) { return _APP.effectiveParentId(c.id) === parentId; });
        children.sort(function (a, b) { return _APP.getPosition(a.id) - _APP.getPosition(b.id); });
        children.forEach(function (cat) {
            if (visited[cat.id]) return;
            visited[cat.id] = true;
            result.push({ id: cat.id, name: cat.name, parentId: _APP.effectiveParentId(cat.id), depth: _APP.getDepth(cat.id), position: _APP.getPosition(cat.id) });
            visitGroup(cat.id);
        });
    }
    visitGroup('root');
    _APP.allCategories.forEach(function (cat) {
        if (!visited[cat.id]) result.push({ id: cat.id, name: cat.name, parentId: _APP.effectiveParentId(cat.id), depth: _APP.getDepth(cat.id), position: _APP.getPosition(cat.id) });
    });
    return result;
};

_APP.applyDrop = function (srcId, tgtId, tgtParent, dropTop) {
    if (dropTop) {
        if (tgtParent !== 'root' && _APP.isDescendant(srcId, tgtParent)) { alert('Cannot move: circular reference.'); return false; }
        _APP.pendingParent[srcId] = tgtParent;
        var siblings = _APP.allCategories.filter(function (c) { return c.id !== srcId && _APP.effectiveParentId(c.id) === tgtParent; }).sort(function (a, b) { return _APP.getPosition(a.id) - _APP.getPosition(b.id); });
        var tgtPos = siblings.length;
        for (var i = 0; i < siblings.length; i++) { if (siblings[i].id === tgtId) { tgtPos = i; break; } }
        siblings.splice(tgtPos, 0, _APP.catMap[srcId]);
        siblings.forEach(function (s, idx) { _APP.pendingOrder[s.id] = idx + 1; });
    } else {
        if (tgtId === srcId || _APP.isDescendant(srcId, tgtId)) { alert('Cannot move: circular reference.'); return false; }
        _APP.pendingParent[srcId] = tgtId;
        var ec = _APP.allCategories.filter(function (c) { return c.id !== srcId && _APP.effectiveParentId(c.id) === tgtId; }).sort(function (a, b) { return _APP.getPosition(a.id) - _APP.getPosition(b.id); });
        ec.forEach(function (c, idx) { _APP.pendingOrder[c.id] = idx + 1; });
        _APP.pendingOrder[srcId] = ec.length + 1;
    }
    return true;
};

_APP.buildLevelFilterTabs = function () {
    var tabsEl = document.getElementById('level-filter-tabs');
    if (!tabsEl) return;
    var depths = {};
    _APP.allCategories.forEach(function (c) { var d = _APP.getDepth(c.id); depths[d] = (depths[d] || 0) + 1; });
    var levels = Object.keys(depths).map(Number).sort(function (a, b) { return a - b; });
    var colors = ['#0070d2', '#5b5fc7', '#2e7d32', '#e65100', '#78909c'];
    var html = '<button type="button" data-level="all" style="padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:2px solid #0070d2;' + (_APP.activeFilter === 'all' ? 'background:#0070d2;color:#fff;' : 'background:#fff;color:#0070d2;') + '">All (' + _APP.allCategories.length + ')</button>';
    levels.forEach(function (lvl) {
        var color = colors[lvl] || '#78909c';
        var isActive = _APP.activeFilter === String(lvl);
        html += '<button type="button" data-level="' + lvl + '" style="padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;border:2px solid ' + color + ';' + (isActive ? 'background:' + color + ';color:#fff;' : 'background:#fff;color:' + color + ';') + '">L' + (lvl + 1) + ' (' + depths[lvl] + ')</button>';
    });
    tabsEl.innerHTML = html;
    tabsEl.style.display = 'flex';
    var btns = tabsEl.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', function () { _APP.activeFilter = this.getAttribute('data-level'); _APP.buildLevelFilterTabs(); _APP.applyLevelFilter(); });
    }
};

_APP.applyLevelFilter = function () {
    var rows = document.querySelectorAll('#main-cat-tbody tr[data-catid]');
    for (var i = 0; i < rows.length; i++) { rows[i].style.display = (_APP.activeFilter === 'all' || rows[i].getAttribute('data-depth') === _APP.activeFilter) ? '' : 'none'; }
};

_APP.updatePendingSummary = function () {
    var allIds = {};
    Object.keys(_APP.pendingParent).forEach(function (k) { allIds[k] = true; });
    Object.keys(_APP.pendingOrder).forEach(function (k) { allIds[k] = true; });
    var total = Object.keys(allIds).length;
    var s = document.getElementById('hierarchy-changes-summary');
    var b = document.getElementById('btn-save-hierarchy');
    var c = document.getElementById('hierarchy-changes-count');
    if (total > 0) { if (s) s.style.display = 'block'; if (b) b.style.display = 'inline-block'; if (c) c.textContent = total; }
    else { if (s) s.style.display = 'none'; if (b) b.style.display = 'none'; }
};

_APP.renderTable = function () {
    var tbody = document.getElementById('main-cat-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!_APP.allCategories.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#54698d;">Click Load Categories from CT to begin.</td></tr>'; return; }
    var sorted = _APP.buildSortedRows();
    sorted.forEach(function (row, idx) {
        var catId = row.id;
        var isPC = _APP.pendingParent[catId] !== undefined || _APP.hierarchyOverrides[catId] !== undefined;
        var isOC = _APP.pendingOrder[catId] !== undefined || _APP.orderOverrides[catId] !== undefined;
        var isChanged = isPC || isOC;
        var currentParent = row.parentId;
        var lvlColor = _APP.getLevelColor(row.depth);
        var lvlLabel = 'L' + (row.depth + 1);
        var origParent = _APP.catMap[catId] ? (_APP.catMap[catId].parentId || 'root') : 'root';
        var parentOpts = _APP.buildParentOptions(catId).replace('value="' + currentParent + '"', 'value="' + currentParent + '" selected');
        var sb = isPC ? '#0070d2' : '#dddbda';
        var sbg = isPC ? '#e8f4fd' : '#fff';
        var pb = isOC ? 'background:#fff3e0;border-color:#ffb300;color:#e65100;' : '';
        var rb = isChanged ? 'background:#fff8e1;' : '';
        tbody.innerHTML += '<tr data-catid="' + catId + '" data-depth="' + row.depth + '" data-parent="' + currentParent + '" data-changed="' + (isChanged ? '1' : '0') + '" style="' + rb + '">'
            + '<td style="padding:7px 8px;border-bottom:1px solid #f0f0f0;text-align:center;"><span class="drag-handle-icon" data-catid="' + catId + '" style="cursor:grab;color:#a8b7c7;font-size:20px;user-select:none;">&#8597;</span></td>'
            + '<td style="padding:7px 8px;border-bottom:1px solid #f0f0f0;"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;color:#fff;background:' + lvlColor + ';">' + lvlLabel + '</span></td>'
            + '<td style="padding:7px 8px;border-bottom:1px solid #f0f0f0;"><span id="pos-' + catId + '" style="' + pb + '">' + (idx + 1) + '</span></td>'
            + '<td style="padding:7px 8px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:11px;">' + catId + '</td>'
            + '<td style="padding:7px 8px;border-bottom:1px solid #f0f0f0;font-weight:600;color:#16325c;">' + _APP.toCamelCase(row.name) + '</td>'
            + '<td style="padding:7px 8px;border-bottom:1px solid #f0f0f0;"><select data-catid="' + catId + '" data-orig="' + origParent + '" style="width:100%;font-size:12px;padding:4px 6px;border:1px solid ' + sb + ';border-radius:3px;background:' + sbg + ';">' + parentOpts + '</select></td>'
            + '</tr>';
    });
    var selects = tbody.querySelectorAll('select');
    for (var i = 0; i < selects.length; i++) { selects[i].addEventListener('change', _APP.onParentDropdownChange); }
    _APP.initDragDrop(tbody);
    _APP.buildLevelFilterTabs();
    _APP.applyLevelFilter();
    _APP.updatePendingSummary();
};

_APP.onParentDropdownChange = function (evt) {
    var select = evt.target;
    var catId = select.getAttribute('data-catid');
    var orig = select.getAttribute('data-orig');
    var newVal = select.value;
    if (newVal === catId) { alert('A category cannot be its own parent.'); select.value = _APP.effectiveParentId(catId); return; }
    if (newVal !== 'root' && _APP.isDescendant(catId, newVal)) { alert('Cannot set: circular reference.'); select.value = _APP.effectiveParentId(catId); return; }
    if (newVal === orig) { delete _APP.pendingParent[catId]; } else {
        _APP.pendingParent[catId] = newVal;
        var sib = _APP.allCategories.filter(function (c) { return c.id !== catId && _APP.effectiveParentId(c.id) === newVal; }).sort(function (a, b) { return _APP.getPosition(a.id) - _APP.getPosition(b.id); });
        _APP.pendingOrder[catId] = sib.length + 1;
    }
    _APP.updatePendingSummary();
    _APP.renderTable();
};

_APP.initDragDrop = function (tbody) {
    var dragRow = null; var dragId = null;
    function getRow(el) { while (el && el.tagName !== 'TR') el = el.parentNode; return (el && el.getAttribute('data-catid')) ? el : null; }
    function getAllRows() { return Array.prototype.slice.call(tbody.querySelectorAll('tr[data-catid]')); }
    function removePH() { var p = document.getElementById('drag-placeholder'); if (p && p.parentNode) p.parentNode.removeChild(p); }
    function makePH(h) { var p = document.createElement('tr'); p.id = 'drag-placeholder'; p.style.cssText = 'height:' + (h || 36) + 'px;background:#e8f4fd;pointer-events:none;'; return p; }
    function getRowAtY(y) {
        var rows = getAllRows();
        for (var i = 0; i < rows.length; i++) { if (rows[i].style.display === 'none') continue; var r = rows[i].getBoundingClientRect(); if (y >= r.top && y <= r.bottom) return { row: rows[i], top: y < r.top + r.height / 2 }; }
        var last = null; for (var j = rows.length - 1; j >= 0; j--) { if (rows[j].style.display !== 'none') { last = rows[j]; break; } }
        if (last) { var lr = last.getBoundingClientRect(); if (y > lr.bottom) return { row: last, top: false }; }
        return null;
    }
    function onMM(e) {
        if (!dragRow) return; e.preventDefault();
        var rz = document.getElementById('root-drop-zone');
        if (rz) { var rr = rz.getBoundingClientRect(); if (e.clientY >= rr.top && e.clientY <= rr.bottom && e.clientX >= rr.left && e.clientX <= rr.right) { rz.style.background = '#cce4f7'; rz.style.borderColor = '#0050a0'; removePH(); return; } else { rz.style.background = '#f0f7ff'; rz.style.borderColor = '#0070d2'; } }
        var hit = getRowAtY(e.clientY); if (!hit || hit.row === dragRow) return;
        removePH(); var ph = makePH(dragRow.getBoundingClientRect().height);
        if (hit.top) { ph.style.borderTop = '3px solid #0070d2'; hit.row.parentNode.insertBefore(ph, hit.row); }
        else { ph.style.borderBottom = '3px solid #5b5fc7'; var ns = hit.row.nextSibling; if (ns) hit.row.parentNode.insertBefore(ph, ns); else hit.row.parentNode.appendChild(ph); }
    }
    function onMU(e) {
        document.removeEventListener('mousemove', onMM); document.removeEventListener('mouseup', onMU);
        if (!dragRow) return;
        dragRow.style.opacity = ''; dragRow.style.background = dragRow.getAttribute('data-changed') === '1' ? '#fff8e1' : '';
        var rz = document.getElementById('root-drop-zone');
        if (rz) { var rr = rz.getBoundingClientRect(); if (e.clientY >= rr.top && e.clientY <= rr.bottom && e.clientX >= rr.left && e.clientX <= rr.right) { removePH(); rz.style.display = 'none'; _APP.pendingParent[dragId] = 'root'; var rc = _APP.allCategories.filter(function (c) { return c.id !== dragId && _APP.effectiveParentId(c.id) === 'root'; }).sort(function (a, b) { return _APP.getPosition(a.id) - _APP.getPosition(b.id); }); rc.forEach(function (c, idx) { _APP.pendingOrder[c.id] = idx + 1; }); _APP.pendingOrder[dragId] = rc.length + 1; dragRow = null; dragId = null; _APP.draggingId = null; _APP.updatePendingSummary(); _APP.renderTable(); return; } rz.style.display = 'none'; }
        var p = document.getElementById('drag-placeholder'); if (!p) { dragRow = null; dragId = null; _APP.draggingId = null; return; }
        var isTop = p.style.borderTop !== ''; var tgt = null;
        if (isTop) { var nx = p.nextSibling; while (nx && (!nx.getAttribute || !nx.getAttribute('data-catid'))) nx = nx.nextSibling; if (nx && nx.getAttribute('data-catid')) tgt = nx; }
        else { var pv = p.previousSibling; while (pv && (!pv.getAttribute || !pv.getAttribute('data-catid'))) pv = pv.previousSibling; if (pv && pv.getAttribute('data-catid')) tgt = pv; }
        removePH();
        if (!tgt || tgt === dragRow) { dragRow = null; dragId = null; _APP.draggingId = null; return; }
        var ok = _APP.applyDrop(dragId, tgt.getAttribute('data-catid'), tgt.getAttribute('data-parent'), isTop);
        dragRow = null; dragId = null; _APP.draggingId = null;
        if (ok) { _APP.updatePendingSummary(); _APP.renderTable(); }
    }
    var handles = tbody.querySelectorAll('.drag-handle-icon');
    for (var h = 0; h < handles.length; h++) {
        handles[h].addEventListener('mousedown', function (e) {
            e.preventDefault(); var row = getRow(e.target); if (!row) return;
            dragRow = row; dragId = row.getAttribute('data-catid'); _APP.draggingId = dragId;
            dragRow.style.opacity = '0.5'; dragRow.style.background = '#e8f4fd';
            var rz = document.getElementById('root-drop-zone'); if (rz) rz.style.display = 'block';
            document.addEventListener('mousemove', onMM); document.addEventListener('mouseup', onMU);
        });
    }
};

_APP.finalize = function (success, message) {
    _APP.running = false;
    var btn = document.getElementById('cat-start-btn');
    if (btn) { btn.disabled = false; btn.textContent = success ? 'Migration Complete' : 'Migration Failed'; }
    var box = document.getElementById('cat-move-status');
    if (box) { box.style.display = 'block'; box.style.padding = '12px 16px'; box.style.borderRadius = '4px'; box.style.fontSize = '13px'; box.style.background = success ? '#e8f5e9' : '#fff3e0'; box.style.border = success ? '1px solid #2e7d32' : '1px solid #ffb300'; box.style.color = success ? '#2e7d32' : '#e65100'; box.textContent = message; }
};

_APP.addToHistory = function (catId, catName, parentId, statusText) {
    var histEl = document.getElementById('new-cat-history');
    var tbody = document.getElementById('new-cat-history-tbody');
    if (!tbody) return;
    var color = statusText === 'Created' ? '#2e7d32' : '#c62828';
    var bg = statusText === 'Created' ? '#e8f5e9' : '#ffebee';
    tbody.innerHTML += '<tr><td style="padding:8px 12px;border:1px solid #dddbda;font-family:monospace;font-size:11px;">' + catId + '</td><td style="padding:8px 12px;border:1px solid #dddbda;">' + catName + '</td><td style="padding:8px 12px;border:1px solid #dddbda;font-size:12px;color:#54698d;">' + (parentId === 'root' ? 'root (L1)' : parentId) + '</td><td style="padding:8px 12px;border:1px solid #dddbda;"><span style="background:' + bg + ';color:' + color + ';padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">' + statusText + '</span></td></tr>';
    if (histEl) histEl.style.display = 'block';
};

_APP.renderParentPickerList = function (query) {
    var list = document.getElementById('parent-picker-list');
    if (!list) return;
    if (!_APP.allCategories.length) { list.innerHTML = '<div style="padding:16px;color:#54698d;text-align:center;">Load categories from CT first (Step 2).</div>'; return; }
    var sorted = _APP.buildSortedRows(); var html = '';
    sorted.forEach(function (row) {
        if (query && row.id.toLowerCase().indexOf(query) === -1 && row.name.toLowerCase().indexOf(query) === -1) return;
        var lvlColor = _APP.getLevelColor(row.depth); var lvlLabel = 'L' + (row.depth + 1);
        html += '<div onclick="pickParent(\'' + row.id + '\')" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:10px;" onmouseover="this.style.background=\'#f4f6f9\'" onmouseout="this.style.background=\'\'">'
            + '<span style="display:inline-block;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700;color:#fff;background:' + lvlColor + ';">' + lvlLabel + '</span>'
            + '<span style="font-size:12px;font-family:monospace;color:#54698d;">' + row.id + '</span>'
            + '<span style="font-size:13px;font-weight:600;color:#16325c;">' + _APP.toCamelCase(row.name) + '</span>'
            + '</div>';
    });
    if (!html) html = '<div style="padding:16px;color:#54698d;text-align:center;">No categories found.</div>';
    list.innerHTML = html;
};

window.pickParent = function (catId) {
    var inp = document.getElementById('new-cat-parent'); if (inp) inp.value = catId;
    var modal = document.getElementById('parent-picker-modal'); if (modal) modal.style.display = 'none';
};

_APP.init = function () {
    document.getElementById('btn-load-catalogs').addEventListener('click', function () { var btn = this; var status = document.getElementById('catalog-load-status'); var sel = document.getElementById('cat-catalog-select'); btn.disabled = true; btn.textContent = 'Loading...'; if (status) { status.textContent = 'Fetching catalogs...'; status.style.color = '#54698d'; } _APP.post(_APP.FETCH_CATALOGS_URL, '', function (data) { btn.disabled = false; btn.textContent = 'Load Catalogs'; if (!data.ok) { if (status) { status.textContent = 'Error: ' + (data.error || 'failed'); status.style.color = '#c62828'; } return; } if (sel) { sel.innerHTML = '<option value="">-- Select a catalog --</option>'; (data.catalogs || []).forEach(function (c) { sel.innerHTML += '<option value="' + c.id + '">' + c.name + ' (' + c.id + ')</option>'; }); } if (status) { status.textContent = data.total + ' catalogs loaded'; status.style.color = '#2e7d32'; } }); });
    var selEl = document.getElementById('cat-catalog-select'); if (selEl) selEl.addEventListener('change', function () { var cid = document.getElementById('cat-catalog-id'); if (cid && this.value) cid.value = this.value; });
    document.getElementById('btn-check-attrs').addEventListener('click', function () { var btn = this; btn.disabled = true; btn.textContent = 'Checking...'; _APP.post(_APP.ATTRS_URL, '', function (data) { btn.disabled = false; btn.textContent = 'Check and Create Attributes'; var ATTR_META = {}; var tbody = document.getElementById('attr-tbody'); if (tbody) { tbody.innerHTML = ''; Object.keys(ATTR_META).forEach(function (attrId) { var meta = ATTR_META[attrId]; var created = data.created && data.created.indexOf(attrId) > -1; var warned = data.warnings && data.warnings.join(' ').indexOf(attrId) > -1; var errored = data.errors && data.errors.join(' ').indexOf(attrId) > -1; var bs = created ? 'background:#e8f5e9;color:#2e7d32;' : warned ? 'background:#fff3e0;color:#e65100;' : errored ? 'background:#ffebee;color:#c62828;' : 'background:#fff3e0;color:#e65100;'; var bt = created ? 'Created' : warned ? 'Already Exists' : errored ? 'Error' : 'Already Exists'; tbody.innerHTML += '<tr><td style="padding:8px 12px;border:1px solid #dddbda;"><code>' + attrId + '</code></td><td style="padding:8px 12px;border:1px solid #dddbda;">' + meta.type + '</td><td style="padding:8px 12px;border:1px solid #dddbda;">' + meta.desc + '</td><td style="padding:8px 12px;border:1px solid #dddbda;"><span style="' + bs + 'padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">' + bt + '</span></td></tr>'; }); } var warnBox = document.getElementById('attr-warnings'); if (warnBox) { warnBox.style.display = (data.warnings && data.warnings.length) ? 'block' : 'none'; warnBox.textContent = (data.warnings && data.warnings.length) ? 'Warnings: ' + data.warnings.join(', ') : ''; } var errorBox = document.getElementById('attr-errors'); if (errorBox) { errorBox.style.display = (data.errors && data.errors.length) ? 'block' : 'none'; errorBox.textContent = (data.errors && data.errors.length) ? 'Errors: ' + data.errors.join(', ') : ''; } var ar = document.getElementById('attr-result'); if (ar) ar.style.display = 'block'; var ao = document.getElementById('attr-overall'); if (ao) ao.textContent = data.ok ? 'Done - proceed to Step 2' : 'Completed with errors'; if (!data.errors || data.errors.length === 0) { setTimeout(function () { _APP.goToStep(2); }, 1200); } }); });
    document.getElementById('btn-skip-attrs').addEventListener('click', function () { _APP.goToStep(2); });
    document.getElementById('btn-save-hierarchy').addEventListener('click', function () { Object.keys(_APP.pendingParent).forEach(function (k) { _APP.hierarchyOverrides[k] = _APP.pendingParent[k]; }); Object.keys(_APP.pendingOrder).forEach(function (k) { _APP.orderOverrides[k] = _APP.pendingOrder[k]; }); _APP.pendingParent = {}; _APP.pendingOrder = {}; _APP.renderTable(); var total = Object.keys(_APP.hierarchyOverrides).length + Object.keys(_APP.orderOverrides).length; var applied = document.getElementById('hierarchy-applied-summary'); var appCnt = document.getElementById('hierarchy-applied-count'); if (appCnt) appCnt.textContent = total; if (applied) applied.style.display = 'block'; document.getElementById('hierarchy-changes-summary').style.display = 'none'; document.getElementById('btn-save-hierarchy').style.display = 'none'; });
    document.getElementById('btn-reset-hierarchy').addEventListener('click', function () { _APP.hierarchyOverrides = {}; _APP.orderOverrides = {}; _APP.pendingParent = {}; _APP.pendingOrder = {}; _APP.activeFilter = 'all'; var applied = document.getElementById('hierarchy-applied-summary'); var summary = document.getElementById('hierarchy-changes-summary'); var saveBtn = document.getElementById('btn-save-hierarchy'); if (applied) applied.style.display = 'none'; if (summary) summary.style.display = 'none'; if (saveBtn) saveBtn.style.display = 'none'; _APP.renderTable(); });
    document.getElementById('hierarchy-search').addEventListener('input', function () { var query = this.value.toLowerCase(); var rows = document.querySelectorAll('#main-cat-tbody tr[data-catid]'); for (var i = 0; i < rows.length; i++) { var ms = !query || rows[i].textContent.toLowerCase().indexOf(query) > -1; var ml = _APP.activeFilter === 'all' || rows[i].getAttribute('data-depth') === _APP.activeFilter; rows[i].style.display = (ms && ml) ? '' : 'none'; } });
    document.getElementById('btn-load-categories').addEventListener('click', function () { var btn = this; var status = document.getElementById('hierarchy-fetch-status'); var locale = document.getElementById('cat-locale') ? document.getElementById('cat-locale').value.trim() : 'en-US'; btn.disabled = true; btn.textContent = 'Loading...'; if (status) { status.textContent = 'Fetching from Commercetools...'; status.style.color = '#54698d'; } _APP.post(_APP.FETCH_URL, 'locale=' + encodeURIComponent(locale || 'en-US'), function (data) { btn.disabled = false; btn.textContent = 'Load Categories from CT'; if (!data.ok) { if (status) { status.textContent = 'Error: ' + (data.error || 'failed'); status.style.color = '#c62828'; } return; } _APP.allCategories = data.categories; _APP.catMap = {}; _APP.hierarchyOverrides = {}; _APP.orderOverrides = {}; _APP.pendingParent = {}; _APP.pendingOrder = {}; _APP.activeFilter = 'all'; _APP.allCategories.forEach(function (c) { _APP.catMap[c.id] = c; }); if (status) { status.textContent = data.total + ' categories loaded'; status.style.color = '#2e7d32'; } var applied = document.getElementById('hierarchy-applied-summary'); if (applied) applied.style.display = 'none'; _APP.renderTable(); }); });
    document.getElementById('btn-back-to-step1').addEventListener('click', function () { _APP.goToStep(1); });
    document.getElementById('btn-back-to-step2').addEventListener('click', function () { _APP.goToStep(2); });
    document.getElementById('btn-next-to-step3').addEventListener('click', function () { var pc = Object.keys(_APP.pendingParent).length + Object.keys(_APP.pendingOrder).length; if (pc > 0 && !confirm(pc + ' unsaved change(s) will be discarded. Proceed?')) return; _APP.pendingParent = {}; _APP.pendingOrder = {}; var s = document.getElementById('step3-summary'); if (s) s.textContent = 'Step 3 of 3 - Export. Categories: ' + _APP.allCategories.length + ' | Parent changes: ' + Object.keys(_APP.hierarchyOverrides).length + ' | Order changes: ' + Object.keys(_APP.orderOverrides).length + ' | Catalog: ' + (_APP.getCatalogId() || 'not set'); _APP.goToStep(3); });
    var oiEl = document.getElementById('btn-open-impex'); if (oiEl) oiEl.addEventListener('click', function (e) { e.preventDefault(); _APP.openInNewTab(_APP.IMPEX_URL); });
    var oiEl2 = document.getElementById('btn-open-import'); if (oiEl2) oiEl2.addEventListener('click', function (e) { e.preventDefault(); _APP.openInNewTab(_APP.IMPORT_URL); });
    document.getElementById('cat-start-btn').addEventListener('click', function () { if (_APP.running) return; var catalogId = _APP.getCatalogId(); var locale = document.getElementById('cat-locale') ? document.getElementById('cat-locale').value.trim() : 'en-US'; if (!catalogId) { alert('Please select or enter a Target Catalog ID.'); return; } if (!locale) { alert('Please enter a Default Locale.'); return; } _APP.running = true; this.disabled = true; this.textContent = 'Running...'; var cs = document.getElementById('cat-move-status'); if (cs) cs.style.display = 'none'; var pl = document.getElementById('cat-phase-list'); if (pl) pl.style.display = 'block'; var xc = document.getElementById('cat-xml-controls'); if (xc) xc.style.display = 'none'; _APP.setPhase('fetch', 'active', 'Fetching and transforming categories...', 10); _APP.setPhase('import', 'pending', 'Waiting for Phase 1...', 0); var fo = {}; Object.keys(_APP.hierarchyOverrides).forEach(function (k) { fo[k] = { parent: _APP.hierarchyOverrides[k] }; }); Object.keys(_APP.orderOverrides).forEach(function (k) { if (!fo[k]) fo[k] = {}; fo[k].position = _APP.orderOverrides[k]; }); _APP.post(_APP.MIGRATE_URL, 'catalogId=' + encodeURIComponent(catalogId) + '&locale=' + encodeURIComponent(locale) + '&mode=xml&overrides=' + encodeURIComponent(JSON.stringify(fo)), function (data) { if (!data.ok) { _APP.setPhase('fetch', 'error', data.error || 'Failed', 0); _APP.finalize(false, data.error || 'Migration failed.'); return; } _APP.setPhase('fetch', 'done', data.total + ' categories fetched and transformed', 100); _APP.setPhase('import', 'active', 'Writing XML to IMPEX...', 50); var xp = document.getElementById('cat-xml-path'); if (xp) xp.textContent = data.xmlPath || ''; if (xc) xc.style.display = 'block'; _APP.setPhase('import', 'done', 'XML written - click buttons below to open IMPEX', 100); _APP.finalize(true, data.total + ' categories exported to IMPEX XML. Use the buttons above to complete the import in BM.'); }); });
    document.getElementById('btn-create-catalog').addEventListener('click', function () { var btn = this; var catId = document.getElementById('new-catalog-id').value.trim(); var catName = document.getElementById('new-catalog-name').value.trim(); var idErr = document.getElementById('new-catalog-id-error'); var nameErr = document.getElementById('new-catalog-name-error'); var status = document.getElementById('new-catalog-status'); var result = document.getElementById('new-catalog-result'); if (idErr) idErr.style.display = 'none'; if (nameErr) nameErr.style.display = 'none'; if (result) result.style.display = 'none'; if (!catId) { if (idErr) idErr.style.display = 'block'; return; } if (!catName) { if (nameErr) nameErr.style.display = 'block'; return; } btn.disabled = true; btn.textContent = 'Generating...'; if (status) { status.textContent = 'Writing catalog XML...'; status.style.color = '#54698d'; } _APP.post(_APP.CREATE_CATALOG_URL, 'catalogId=' + encodeURIComponent(catId) + '&catalogName=' + encodeURIComponent(catName), function (data) { btn.disabled = false; btn.textContent = 'Generate Catalog XML'; if (!data.ok) { if (status) { status.textContent = 'Error: ' + (data.error || 'failed'); status.style.color = '#c62828'; } return; } if (status) { status.textContent = 'Done'; status.style.color = '#2e7d32'; } var xp = document.getElementById('new-catalog-xml-path'); if (xp) xp.textContent = data.xmlPath || ''; if (result) result.style.display = 'block'; }); });
    var nciEl = document.getElementById('btn-new-catalog-impex'); if (nciEl) nciEl.addEventListener('click', function (e) { e.preventDefault(); _APP.openInNewTab(_APP.IMPEX_URL); });
    var nciEl2 = document.getElementById('btn-new-catalog-import'); if (nciEl2) nciEl2.addEventListener('click', function (e) { e.preventDefault(); _APP.openInNewTab(_APP.IMPORT_URL); });
    document.getElementById('btn-pick-parent').addEventListener('click', function () { var modal = document.getElementById('parent-picker-modal'); if (modal) modal.style.display = 'block'; _APP.renderParentPickerList(''); });
    var ppSearch = document.getElementById('parent-picker-search'); if (ppSearch) ppSearch.addEventListener('input', function () { _APP.renderParentPickerList(this.value.toLowerCase()); });
    var cpEl = document.getElementById('btn-close-picker'); if (cpEl) cpEl.addEventListener('click', function () { var m = document.getElementById('parent-picker-modal'); if (m) m.style.display = 'none'; });
    document.getElementById('btn-create-category').addEventListener('click', function () { var btn = this; var catId = document.getElementById('new-cat-id').value.trim(); var catName = document.getElementById('new-cat-name').value.trim(); var parentId = document.getElementById('new-cat-parent').value.trim() || 'root'; var catalogId = _APP.getCatalogId(); var idErr = document.getElementById('new-cat-id-error'); var nameErr = document.getElementById('new-cat-name-error'); var status = document.getElementById('new-cat-status'); var result = document.getElementById('new-cat-result'); if (idErr) idErr.style.display = 'none'; if (nameErr) nameErr.style.display = 'none'; if (result) result.style.display = 'none'; if (!catId) { if (idErr) idErr.style.display = 'block'; return; } if (!catName) { if (nameErr) nameErr.style.display = 'block'; return; } if (!catalogId) { alert('Please select or enter a Target Catalog ID in the config bar above.'); return; } btn.disabled = true; btn.textContent = 'Creating...'; if (status) { status.textContent = 'Creating category in SFCC...'; status.style.color = '#54698d'; } _APP.post(_APP.CREATE_CATEGORY_URL, 'catalogId=' + encodeURIComponent(catalogId) + '&categoryId=' + encodeURIComponent(catId) + '&categoryName=' + encodeURIComponent(catName) + '&parentId=' + encodeURIComponent(parentId), function (data) { btn.disabled = false; btn.textContent = 'Create Category in SFCC'; if (result) { result.style.display = 'block'; result.style.padding = '14px 16px'; result.style.borderRadius = '4px'; } if (!data.ok) { if (status) status.textContent = ''; if (result) { result.style.background = '#ffebee'; result.style.border = '1px solid #c62828'; result.style.color = '#c62828'; result.textContent = 'Error: ' + (data.error || 'Category creation failed. Check BM logs.'); } _APP.addToHistory(catId, catName, parentId, 'Failed'); return; } if (status) status.textContent = ''; if (result) { result.style.background = '#e8f5e9'; result.style.border = '1px solid #2e7d32'; result.style.color = '#2e7d32'; result.textContent = 'Category "' + catName + '" (ID: ' + catId + ') created successfully in catalog "' + catalogId + '".'; } _APP.addToHistory(catId, catName, parentId, 'Created'); document.getElementById('new-cat-id').value = ''; document.getElementById('new-cat-name').value = ''; document.getElementById('new-cat-parent').value = ''; }); });
    [1, 2, 3, 4, 5].forEach(function (i) { var tab = document.getElementById('tab-' + i); if (tab) tab.addEventListener('click', function () { _APP.goToStep(i); }); });
    _APP.post(_APP.STATUS_URL, '', function (data) { if (!data.ok) return; var status = data.status || {}; var missing = Object.keys(status).filter(function (k) { return status[k] === 'missing'; }); var infoBox = document.getElementById('step1-info-box'); var skipBtn = document.getElementById('btn-skip-attrs'); if (!missing.length) { if (infoBox) infoBox.textContent = 'Step 1 - Custom attribute (ctId) already exists. You may skip.'; if (skipBtn) { skipBtn.textContent = 'All exist - Skip to Step 2'; skipBtn.style.background = '#e8f5e9'; skipBtn.style.color = '#2e7d32'; } } else { if (infoBox) infoBox.textContent = 'Step 1 - Missing: ' + missing.join(', ') + '. Click Check and Create.'; } });
};