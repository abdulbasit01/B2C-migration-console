/**
 * Auto-attach CSRF tokens to same-origin XHR / form POSTs (LINK security).
 * Expects meta tags: csrf-token-name, csrf-token (set by MenuFrame / withBmFrame).
 */
(function () {
    'use strict';

    function meta(name) {
        var el = document.querySelector('meta[name="' + name + '"]');
        return el ? el.getAttribute('content') : '';
    }

    function tokenName() {
        return meta('csrf-token-name') || 'csrf_token';
    }

    function tokenValue() {
        return meta('csrf-token') || '';
    }

    function appendToken(body) {
        var name = tokenName();
        var value = tokenValue();
        if (!value) return body;
        if (body === null || body === undefined || body === '') {
            return encodeURIComponent(name) + '=' + encodeURIComponent(value);
        }
        if (typeof body === 'string') {
            if (body.indexOf(encodeURIComponent(name) + '=') >= 0 || body.indexOf(name + '=') >= 0) {
                return body;
            }
            return body + (body.length && body.charAt(body.length - 1) !== '&' ? '&' : '')
                + encodeURIComponent(name) + '=' + encodeURIComponent(value);
        }
        if (typeof FormData !== 'undefined' && body instanceof FormData) {
            if (!body.has(name)) body.append(name, value);
            return body;
        }
        return body;
    }

    function ensureFormToken(form) {
        var name = tokenName();
        var value = tokenValue();
        if (!value || !form) return;
        var existing = form.querySelector('input[name="' + name + '"]');
        if (existing) {
            existing.value = value;
            return;
        }
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
    }

    function patchForms() {
        var forms = document.getElementsByTagName('form');
        var i;
        for (i = 0; i < forms.length; i++) {
            ensureFormToken(forms[i]);
            forms[i].addEventListener('submit', function () {
                ensureFormToken(this);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', patchForms);
    } else {
        patchForms();
    }

    var XHR = window.XMLHttpRequest;
    if (!XHR || XHR.__accCsrfPatched) return;
    XHR.__accCsrfPatched = true;

    var open = XHR.prototype.open;
    var send = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
        this.__accMethod = String(method || 'GET').toUpperCase();
        this.__accUrl = String(url || '');
        return open.apply(this, arguments);
    };

    XHR.prototype.send = function (body) {
        var method = this.__accMethod || 'GET';
        if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
            body = appendToken(body);
        }
        return send.call(this, body);
    };

    if (navigator.sendBeacon) {
        var originalBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function (url, data) {
            var name = tokenName();
            var value = tokenValue();
            if (value) {
                var sep = String(url).indexOf('?') >= 0 ? '&' : '?';
                url = url + sep + encodeURIComponent(name) + '=' + encodeURIComponent(value);
            }
            return originalBeacon(url, data);
        };
    }
}());
