'use strict';

/**
 * SFCC Service Framework HTTP helper for B2C Migration Console.
 * All outbound HTTP must go through LocalServiceRegistry (LINK requirement).
 * Credential URLs in services.xml are placeholders; callers pass the full URL.
 */

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Logger = require('dw/system/Logger').getLogger('bm_accelerator', 'ServiceHttp');

var SERVICE_IDS = {
    generic: 'accelerator.http.generic',
    shopify: 'accelerator.shopify.api',
    ctp:     'accelerator.ctp.api',
    sap:     'accelerator.sap.api',
    sfcc:    'accelerator.sfcc.ocapi',
    webdav:  'accelerator.sfcc.webdav'
};

/**
 * Redact secrets from service communication logs.
 * @param {string} msg
 * @returns {string}
 */
function filterLogMessage(msg) {
    if (!msg) return msg;
    var out = String(msg);
    out = out.replace(/("access_token"\s*:\s*")[^"]+"/gi, '$1***"');
    out = out.replace(/("client_secret"\s*:\s*")[^"]+"/gi, '$1***"');
    out = out.replace(/("password"\s*:\s*")[^"]+"/gi, '$1***"');
    out = out.replace(/(Authorization:\s*)[^\r\n]+/gi, '$1***');
    out = out.replace(/(X-Shopify-Access-Token:\s*)[^\r\n]+/gi, '$1***');
    out = out.replace(/(client_secret=)[^&\s]+/gi, '$1***');
    out = out.replace(/(Bearer\s+)[A-Za-z0-9._\-]+/g, '$1***');
    out = out.replace(/(Basic\s+)[A-Za-z0-9+/=]+/g, '$1***');
    out = out.replace(/(shpat_|shpss_|shpua_)[A-Za-z0-9]+/g, '$1***');
    return out;
}

/**
 * @param {string} serviceId
 * @returns {dw.svc.HTTPService}
 */
function createService(serviceId) {
    return LocalServiceRegistry.createService(serviceId, {
        createRequest: function (svc, params) {
            var method = (params && params.method) || 'GET';
            var url    = params && params.url;
            if (!url) {
                throw new Error('serviceHttp: URL is required');
            }
            svc.setRequestMethod(method);
            svc.setURL(url);

            var headers = (params && params.headers) || {};
            var keys = Object.keys(headers);
            var i;
            for (i = 0; i < keys.length; i++) {
                svc.addHeader(keys[i], String(headers[keys[i]]));
            }

            if (params && params.body !== undefined && params.body !== null) {
                return String(params.body);
            }
            return '';
        },

        parseResponse: function (svc, client) {
            var text = '';
            try {
                text = client.text || '';
            } catch (e) {
                text = '';
            }
            var data = {};
            try {
                data = JSON.parse(text || '{}');
            } catch (pe) {
                data = {};
            }
            var link = '';
            try {
                link = client.getResponseHeader('Link') || '';
            } catch (he) {
                link = '';
            }
            return {
                status: client.statusCode,
                data:   data,
                text:   text,
                link:   link
            };
        },

        filterLogMessage: filterLogMessage
    });
}

/**
 * Direct HTTPClient fallback when Service Framework definitions are not imported yet.
 * @param {string} method
 * @param {string} url
 * @param {Object} headers
 * @param {string|null} body
 * @returns {{ status: number, data: Object, text: string, link: string }}
 */
function legacyRequest(method, url, headers, body) {
    var HTTPClient = require('dw/net/HTTPClient');
    var client = new HTTPClient();
    client.setTimeout(12000);
    client.open(method, url);

    var keys = Object.keys(headers || {});
    var i;
    for (i = 0; i < keys.length; i++) {
        client.setRequestHeader(keys[i], headers[keys[i]]);
    }

    client.send(body !== undefined && body !== null ? String(body) : '');

    var text = client.getText() || '';
    var data = {};
    try {
        data = JSON.parse(text || '{}');
    } catch (pe) {
        data = {};
    }

    return {
        status: client.statusCode,
        data:   data,
        text:   text,
        link:   ''
    };
}

/**
 * @param {Error|Object} err
 * @returns {boolean}
 */
function isMissingServiceError(err) {
    var msg = String((err && err.message) || err || '');
    return msg.indexOf('Service is not configured') !== -1
        || msg.indexOf('IllegalArgumentException') !== -1;
}

/**
 * Execute an HTTP call via Service Framework.
 * @param {string} serviceKey - generic|shopify|ctp|sfcc|webdav
 * @param {string} method
 * @param {string} url
 * @param {Object} [headers]
 * @param {string|null} [body]
 * @returns {{ status: number, data: Object, text: string, link: string }}
 */
function request(serviceKey, method, url, headers, body) {
    var serviceId = SERVICE_IDS[serviceKey] || SERVICE_IDS.generic;
    var svc;
    try {
        svc = createService(serviceId);
    } catch (createErr) {
        if (isMissingServiceError(createErr)) {
            Logger.warn('Service {0} not configured; using HTTPClient fallback. Import metadata/services.xml.', serviceId);
            return legacyRequest(method, url, headers, body);
        }
        throw createErr;
    }

    var result;
    try {
        result = svc.call({
            method:  method,
            url:     url,
            headers: headers || {},
            body:    body
        });
    } catch (callErr) {
        if (isMissingServiceError(callErr)) {
            Logger.warn('Service {0} not configured; using HTTPClient fallback. Import metadata/services.xml.', serviceId);
            return legacyRequest(method, url, headers, body);
        }
        throw callErr;
    }

    if (result.ok && result.object) {
        return result.object;
    }

    if (!result.ok && result.errorMessage && isMissingServiceError({ message: result.errorMessage })) {
        Logger.warn('Service {0} not configured; using HTTPClient fallback. Import metadata/services.xml.', serviceId);
        return legacyRequest(method, url, headers, body);
    }

    // Service unavailable / circuit open — surface a stable error shape
    if (result.status === 'SERVICE_UNAVAILABLE') {
        Logger.error('Service {0} unavailable ({1}): {2}', serviceId, result.unavailableReason, result.errorMessage);
        return {
            status: 503,
            data:   {},
            text:   result.errorMessage || ('Service unavailable: ' + result.unavailableReason),
            link:   ''
        };
    }

    // HTTP error responses may still include a parsed object from parseResponse
    if (result.object && typeof result.object.status === 'number') {
        return result.object;
    }

    Logger.error('Service {0} error: {1}', serviceId, result.errorMessage);
    return {
        status: result.error || 500,
        data:   {},
        text:   result.errorMessage || 'Service call failed',
        link:   ''
    };
}

function get(serviceKey, url, headers) {
    return request(serviceKey, 'GET', url, headers);
}

function post(serviceKey, url, headers, body) {
    return request(serviceKey, 'POST', url, headers, body);
}

function put(serviceKey, url, headers, body) {
    return request(serviceKey, 'PUT', url, headers, body);
}

function del(serviceKey, url, headers) {
    return request(serviceKey, 'DELETE', url, headers);
}

function head(serviceKey, url, headers) {
    return request(serviceKey, 'HEAD', url, headers);
}

module.exports = {
    SERVICE_IDS:       SERVICE_IDS,
    filterLogMessage:  filterLogMessage,
    request:           request,
    get:               get,
    post:              post,
    put:               put,
    del:               del,
    head:              head
};
