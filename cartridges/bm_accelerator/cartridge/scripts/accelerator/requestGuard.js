'use strict';

/* global request, response, session */

/**
 * BM session + CSRF guards for Accelerator controller endpoints (LINK security).
 */

var CSRFProtection = require('dw/web/CSRFProtection');
var log = require('*/cartridge/scripts/migration/core/migrationLogger').security;

var MUTATING = {
    POST: true,
    PUT: true,
    DELETE: true,
    PATCH: true
};

/**
 * @returns {boolean}
 */
function isMutatingMethod() {
    var method = String(request.httpMethod || 'GET').toUpperCase();
    return !!MUTATING[method];
}

/**
 * Attach CSRF token fields for ISML pages.
 * @param {Object} pdict
 * @returns {Object}
 */
function attachCsrf(pdict) {
    pdict.csrfTokenName = CSRFProtection.getTokenName();
    pdict.csrfToken = CSRFProtection.generateToken();
    return pdict;
}

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.json=true] - write JSON error body
 * @param {boolean} [opts.csrf=true] - validate CSRF on mutating methods
 * @returns {boolean} true if request may proceed
 */
function guard(opts) {
    var options = opts || {};
    var useJson = options.json !== false;
    var useCsrf = options.csrf !== false;

    if (!session || !session.userAuthenticated) {
        log.warn('Rejected unauthenticated BM request to {0}', request.httpPath);
        response.setStatus(403);
        if (useJson) {
            response.setContentType('application/json');
            response.writer.print(JSON.stringify({ ok: false, error: 'Unauthorized' }));
        }
        return false;
    }

    if (useCsrf && isMutatingMethod()) {
        if (!CSRFProtection.validateRequest()) {
            log.warn('CSRF validation failed for {0}', request.httpPath);
            response.setStatus(403);
            if (useJson) {
                response.setContentType('application/json');
                response.writer.print(JSON.stringify({ ok: false, error: 'Invalid CSRF token' }));
            }
            return false;
        }
    }

    return true;
}

/**
 * Wrap a public controller function with auth + CSRF guards.
 * Page (non-JSON) endpoints skip CSRF for GET and use csrf:false for form POSTs
 * that will validate explicitly, or validate when method is mutating.
 * @param {Function} fn
 * @param {Object} [opts]
 * @returns {Function}
 */
function wrap(fn, opts) {
    var options = opts || {};
    function wrapped() {
        var isPage = options.page === true;
        if (!guard({
            json: !isPage,
            csrf: options.csrf !== false && !isPage
        })) {
            return;
        }
        // Page GETs: still require BM auth (handled above). Form POSTs to page
        // endpoints should include CSRF; validate when mutating.
        if (isPage && isMutatingMethod() && options.csrf !== false) {
            if (!CSRFProtection.validateRequest()) {
                log.warn('CSRF validation failed for page {0}', request.httpPath);
                response.setStatus(403);
                return;
            }
        }
        return fn.apply(this, arguments);
    }
    wrapped.public = true;
    return wrapped;
}

module.exports = {
    attachCsrf:        attachCsrf,
    guard:             guard,
    wrap:              wrap,
    isMutatingMethod:  isMutatingMethod
};
