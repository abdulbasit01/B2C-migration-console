'use strict';

/**
 * OpenAI Chat Completions client for Check Attributes mapping suggestions.
 * Credentials come from Site Preferences (rcMigOpenAi*); never hardcode keys.
 */

var Logger = require('dw/system/Logger').getLogger('bm_accelerator', 'OpenAI');
var serviceHttp = require('*/cartridge/scripts/migration/core/serviceHttp');
var prefs = require('*/cartridge/scripts/migration/migrationPreferences');

var CHAT_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Strip markdown fences and parse JSON from model content.
 * @param {string} text
 * @returns {Object|Array|null}
 */
function parseJsonContent(text) {
    if (!text) return null;
    var raw = String(text).replace(/^\uFEFF/, '').trim();
    if (raw.indexOf('```') === 0) {
        raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    }
    try {
        return JSON.parse(raw);
    } catch (e1) {
        var start = raw.indexOf('{');
        var end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(raw.substring(start, end + 1));
            } catch (e2) {
                return null;
            }
        }
        start = raw.indexOf('[');
        end = raw.lastIndexOf(']');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(raw.substring(start, end + 1));
            } catch (e3) {
                return null;
            }
        }
        return null;
    }
}

/**
 * @returns {{ enabled: boolean, apiKey: string, model: string }}
 */
function getConfig() {
    return prefs.getOpenAiConfig();
}

/**
 * True when suggestions may be requested.
 * @returns {boolean}
 */
function isConfigured() {
    var cfg = getConfig();
    return !!(cfg.enabled && cfg.apiKey);
}

/**
 * Call OpenAI chat completions.
 * @param {Array<{role: string, content: string}>} messages
 * @param {Object} [opts]
 * @param {string} [opts.model]
 * @param {number} [opts.temperature]
 * @returns {{ ok: boolean, content: string, parsed: Object|Array|null, error: string|null, status: number }}
 */
function chatCompletions(messages, opts) {
    opts = opts || {};
    var cfg = getConfig();
    if (!cfg.enabled) {
        return { ok: false, content: '', parsed: null, error: 'OpenAI suggestions disabled', status: 0 };
    }
    if (!cfg.apiKey) {
        return { ok: false, content: '', parsed: null, error: 'OpenAI API key not configured', status: 0 };
    }

    var body = JSON.stringify({
        model:       opts.model || cfg.model || 'gpt-4o-mini',
        temperature: typeof opts.temperature === 'number' ? opts.temperature : 0,
        messages:    messages || []
    });

    var res;
    try {
        res = serviceHttp.post('openai', CHAT_URL, {
            'Content-Type':  'application/json',
            Authorization:   'Bearer ' + cfg.apiKey
        }, body);
    } catch (e) {
        Logger.error('OpenAI request failed: {0}', e.message || e);
        return {
            ok: false,
            content: '',
            parsed: null,
            error: String((e && e.message) || e || 'OpenAI request failed'),
            status: 0
        };
    }

    var status = res && res.status ? res.status : 0;
    if (status < 200 || status >= 300) {
        var errMsg = '';
        try {
            errMsg = (res.data && res.data.error && res.data.error.message)
                || (res.text && String(res.text).substring(0, 200))
                || ('HTTP ' + status);
        } catch (pe) {
            errMsg = 'HTTP ' + status;
        }
        Logger.warn('OpenAI HTTP {0}: {1}', status, errMsg);
        return { ok: false, content: '', parsed: null, error: errMsg, status: status };
    }

    var content = '';
    try {
        var choices = res.data && res.data.choices;
        if (choices && choices.length && choices[0].message) {
            content = String(choices[0].message.content || '');
        }
    } catch (ce) {
        content = '';
    }

    return {
        ok: true,
        content: content,
        parsed: parseJsonContent(content),
        error: null,
        status: status
    };
}

module.exports = {
    CHAT_URL:         CHAT_URL,
    parseJsonContent: parseJsonContent,
    getConfig:        getConfig,
    isConfigured:     isConfigured,
    chatCompletions:  chatCompletions
};
