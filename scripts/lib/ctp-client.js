'use strict';

var fs   = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');
var dns  = require('dns');

var ROOT = path.resolve(__dirname, '..', '..');

var MAX_RETRIES    = 5;
var RETRY_BASE_MS  = 1000;

/**
 * Router/corporate DNS often returns EAI_AGAIN for commercetools hosts.
 * Override with CTP_DNS_SERVERS=8.8.8.8,1.1.1.1 in .env if needed.
 */
function configureDns(env) {
    var raw = (env && env.CTP_DNS_SERVERS) ? env.CTP_DNS_SERVERS : '8.8.8.8,1.1.1.1';
    var servers = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (servers.length) {
        dns.setServers(servers);
    }
}

function sleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function isRetryableError(err) {
    if (!err) return false;
    var code = err.code || '';
    return code === 'EAI_AGAIN'
        || code === 'ENOTFOUND'
        || code === 'ETIMEDOUT'
        || code === 'ECONNRESET'
        || code === 'ECONNREFUSED';
}

function isRetryableStatus(status) {
    return status === 429 || status >= 500;
}

/**
 * Load key=value pairs from project .env (no dependency on dotenv).
 * @returns {Object}
 */
function loadEnv() {
    var envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) {
        throw new Error('.env not found. Copy .env.example to .env and fill CTP credentials.');
    }
    var env = {};
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(function (line) {
        var trimmed = line.trim();
        if (!trimmed || trimmed.charAt(0) === '#') return;
        var eq = trimmed.indexOf('=');
        if (eq < 0) return;
        var key = trimmed.slice(0, eq).trim();
        var val = trimmed.slice(eq + 1).trim();
        env[key] = val;
    });
    return env;
}

/**
 * @returns {{ projectKey: string, clientId: string, clientSecret: string, authUrl: string, apiUrl: string, scopes: string }}
 */
function getCtpConfig(env) {
    env = env || loadEnv();
    configureDns(env);
    if (!env.CTP_PROJECT_KEY || !env.CTP_CLIENT_ID || !env.CTP_CLIENT_SECRET) {
        throw new Error('CTP_PROJECT_KEY, CTP_CLIENT_ID, and CTP_CLIENT_SECRET are required in .env');
    }
    var scopes = env.CTP_SCOPES || '';
    if (!scopes || scopes.indexOf('your-project-key') >= 0) {
        scopes = 'manage_project:' + env.CTP_PROJECT_KEY;
    }
    return {
        projectKey:   env.CTP_PROJECT_KEY,
        clientId:     env.CTP_CLIENT_ID,
        clientSecret: env.CTP_CLIENT_SECRET,
        authUrl:      env.CTP_AUTH_URL || 'https://auth.us-central1.gcp.commercetools.com',
        apiUrl:       env.CTP_API_URL  || 'https://api.us-central1.gcp.commercetools.com',
        scopes:       scopes
    };
}

function requestJsonOnce(url, options, body) {
    return new Promise(function (resolve, reject) {
        var parsed   = new URL(url);
        var isHttps  = parsed.protocol === 'https:';
        var lib      = isHttps ? https : http;
        var payload  = null;

        if (body != null) {
            if (typeof body === 'string') {
                payload = body;
            } else {
                payload = JSON.stringify(body);
            }
        }

        var headers  = Object.assign({}, options.headers || {});

        if (payload) {
            headers['Content-Length'] = Buffer.byteLength(payload);
            if (!headers['Content-Type']) {
                headers['Content-Type'] = 'application/json';
            }
        }

        var req = lib.request({
            hostname: parsed.hostname,
            port:     parsed.port || (isHttps ? 443 : 80),
            path:     parsed.pathname + parsed.search,
            method:   options.method || 'GET',
            headers:  headers
        }, function (res) {
            var chunks = [];
            res.on('data', function (chunk) { chunks.push(chunk); });
            res.on('end', function () {
                var text = Buffer.concat(chunks).toString('utf8');
                var data = null;
                if (text) {
                    try { data = JSON.parse(text); } catch (e) { data = text; }
                }
                resolve({
                    status: res.statusCode,
                    data:   data,
                    text:   text
                });
            });
        });

        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function requestJson(url, options, body) {
    var attempt = 0;

    function run() {
        return requestJsonOnce(url, options, body).then(function (res) {
            if (isRetryableStatus(res.status) && attempt < MAX_RETRIES - 1) {
                attempt++;
                return sleep(RETRY_BASE_MS * attempt).then(run);
            }
            return res;
        }).catch(function (err) {
            if (!isRetryableError(err) || attempt >= MAX_RETRIES - 1) {
                throw err;
            }
            attempt++;
            return sleep(RETRY_BASE_MS * attempt).then(run);
        });
    }

    return run();
}

function basicAuth(clientId, clientSecret) {
    return Buffer.from(clientId + ':' + clientSecret).toString('base64');
}

/**
 * @param {Object} config
 * @returns {Promise<string>}
 */
function getToken(config) {
    var body = 'grant_type=client_credentials';
    if (config.scopes) {
        body += '&scope=' + encodeURIComponent(config.scopes);
    }
    return requestJson(config.authUrl + '/oauth/token', {
        method:  'POST',
        headers: {
            Authorization:  'Basic ' + basicAuth(config.clientId, config.clientSecret),
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    }, body).then(function (res) {
        if (res.status !== 200 || !res.data || !res.data.access_token) {
            var msg = (res.data && res.data.message) ? res.data.message : res.text;
            throw new Error('CTP auth failed (' + res.status + '): ' + msg);
        }
        return res.data.access_token;
    });
}

/**
 * @param {Object} config
 * @param {string} token
 * @param {string} method
 * @param {string} apiPath - e.g. /project-key/inventory
 * @param {Object} [body]
 * @returns {Promise<{status:number,data:*,text:string}>}
 */
function api(config, token, method, apiPath, body) {
    var url = config.apiUrl + apiPath;
    return requestJson(url, {
        method:  method,
        headers: {
            Authorization:  'Bearer ' + token,
            'Content-Type': 'application/json'
        }
    }, body);
}

function projectPath(config, suffix) {
    return '/' + encodeURIComponent(config.projectKey) + suffix;
}

module.exports = {
    loadEnv:      loadEnv,
    getCtpConfig: getCtpConfig,
    getToken:     getToken,
    api:          api,
    projectPath:  projectPath
};
