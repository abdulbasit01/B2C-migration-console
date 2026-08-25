'use strict';

/**
 * Toggle gallery grid vs list layout; persists via URL ?view= and localStorage.
 */
(function () {
    var STORAGE_KEY = 'amp-gallery-view';

    function getGrid() {
        return document.getElementById('amp-gallery-grid');
    }

    function getButtons() {
        return document.querySelectorAll('.amp-gallery__view-btn');
    }

    function getViewInput() {
        return document.getElementById('amp-gallery-view-input');
    }

    function normalizeView(view) {
        return view === 'grid' ? 'grid' : 'list';
    }

    function applyView(view) {
        var grid = getGrid();
        if (!grid) return;

        var mode = normalizeView(view);
        grid.setAttribute('data-view', mode);
        grid.classList.toggle('amp-gallery__grid--list', mode === 'list');

        getButtons().forEach(function (btn) {
            var active = btn.getAttribute('data-view') === mode;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        var viewInput = getViewInput();
        if (viewInput) {
            viewInput.value = mode;
        }

        syncViewLinks(mode);
        syncUrlView(mode);

        try {
            localStorage.setItem(STORAGE_KEY, mode);
        } catch (e) {
            // Ignore storage errors.
        }
    }

    function syncViewLinks(view) {
        var mode = normalizeView(view);
        document.querySelectorAll('a[href*="AmplienceContent-Show"]').forEach(function (link) {
            try {
                var url = new URL(link.href, window.location.origin);
                url.searchParams.set('view', mode);
                link.href = url.pathname + url.search;
            } catch (e) {
                // Ignore malformed URLs.
            }
        });
    }

    function syncUrlView(view) {
        try {
            var url = new URL(window.location.href);
            url.searchParams.set('view', normalizeView(view));
            window.history.replaceState({}, '', url.pathname + url.search);
        } catch (e) {
            // Ignore history errors.
        }
    }

    function readInitialView() {
        var grid = getGrid();
        var fromGrid = grid ? grid.getAttribute('data-view') : '';
        if (fromGrid === 'list' || fromGrid === 'grid') {
            return fromGrid;
        }

        var params = new URLSearchParams(window.location.search);
        var fromUrl = params.get('view');
        if (fromUrl === 'list' || fromUrl === 'grid') {
            return fromUrl;
        }

        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (stored === 'list' || stored === 'grid') {
                return stored;
            }
        } catch (e) {
            // Ignore storage errors.
        }

        return 'list';
    }

    document.addEventListener('DOMContentLoaded', function () {
        applyView(readInitialView());

        document.addEventListener('click', function (event) {
            var btn = event.target;
            if (!btn || !btn.classList || !btn.classList.contains('amp-gallery__view-btn')) {
                return;
            }
            applyView(btn.getAttribute('data-view'));
        });
    });
}());
