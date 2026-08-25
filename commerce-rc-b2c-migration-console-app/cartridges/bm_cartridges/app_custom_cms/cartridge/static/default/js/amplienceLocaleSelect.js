'use strict';

/**
 * Gallery card locale switcher — fetches live Amplience content per card (CDN cached server-side).
 */
(function () {
    function onCardLocaleChange(event) {
        var select = event.currentTarget;
        var card = select.closest('.amp-gallery__item');
        if (!card) return;

        var preview = card.querySelector('.amp-gallery__preview');
        var baseUrl = select.getAttribute('data-preview-url');
        var cid = select.getAttribute('data-cid');
        var locale = select.value;

        if (!preview || !baseUrl || !cid || !locale) return;

        preview.classList.add('amp-gallery__preview--loading');

        fetch(baseUrl + '?cid=' + encodeURIComponent(cid) + '&locale=' + encodeURIComponent(locale), {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin'
        })
            .then(function (response) {
                return response.json();
            })
            .then(function (payload) {
                if (payload && payload.ok && payload.html) {
                    preview.innerHTML = payload.html;
                }
            })
            .catch(function () {
                // Keep existing preview on failure.
            })
            .finally(function () {
                preview.classList.remove('amp-gallery__preview--loading');
            });
    }

    document.addEventListener('change', function (event) {
        if (event.target && event.target.classList
            && event.target.classList.contains('amp-card-locale-select')) {
            onCardLocaleChange(event);
        }
    });
}());
