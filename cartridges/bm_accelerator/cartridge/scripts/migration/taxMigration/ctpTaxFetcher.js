'use strict';

var http     = require('*/cartridge/scripts/migration/core/http');
var cfg      = require('*/cartridge/scripts/migration/configAccessor');
var Encoding = require('dw/crypto/Encoding');
var Bytes    = require('dw/util/Bytes');

function toBase64(str) {
    return Encoding.toBase64(new Bytes(str, 'UTF-8'));
}

function getToken() {
    var c    = cfg.ctp;
    var body = 'grant_type=client_credentials';

    var res = http.post(
        c.authUrl + '/oauth/token',
        {
            Authorization:  'Basic ' + toBase64(c.clientId + ':' + c.clientSecret),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    );
    if (res.status !== 200 || !res.data.access_token) {
        throw new Error('CTP auth failed (' + res.status + ')');
    }
    return res.data.access_token;
}

function ctpErrorDetail(res) {
    if (!res) return '';
    if (res.data && res.data.message) return String(res.data.message);
    if (res.data && res.data.errors && res.data.errors.length) {
        var err = res.data.errors[0];
        return err.message || err.title || JSON.stringify(err);
    }
    if (res.text) return String(res.text).substring(0, 300);
    return '';
}

function failCtp(label, res) {
    var detail = ctpErrorDetail(res);
    throw new Error(label + ' (' + res.status + ')' + (detail ? ': ' + detail : ''));
}

function exportKeySafe(key) {
    return String(key || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getLocalized(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return obj.en || obj['en-US'] || obj['en-GB'] || obj.default
        || (Object.keys(obj).length > 0 ? obj[Object.keys(obj)[0]] : '') || '';
}

var COUNTRY_NAMES = {
    US: 'United States',
    GB: 'United Kingdom',
    UK: 'United Kingdom',
    DE: 'Germany',
    FR: 'France',
    IT: 'Italy',
    ES: 'Spain',
    CA: 'Canada',
    AU: 'Australia',
    NL: 'Netherlands',
    BE: 'Belgium',
    AT: 'Austria',
    CH: 'Switzerland',
    IE: 'Ireland',
    SE: 'Sweden',
    NO: 'Norway',
    DK: 'Denmark',
    FI: 'Finland',
    PL: 'Poland',
    PT: 'Portugal',
    IN: 'India',
    JP: 'Japan',
    CN: 'China',
    BR: 'Brazil',
    MX: 'Mexico'
};

/**
 * Human-friendly country label from ISO code.
 * @param {string} code
 * @returns {string}
 */
function countryDisplayLabel(code) {
    if (!code) return '';
    var c = String(code).trim();
    if (!c) return '';
    var upper = c.toUpperCase();
    var name  = COUNTRY_NAMES[upper];
    if (name) {
        return upper + ' (' + name + ')';
    }
    return c;
}

/**
 * Overview rows for the tax migration UI.
 * @returns {{ rows: Array, classLabels: string, countryLabels: string, classCount: number, rateCount: number, jurisdictionCount: number }}
 */
function getTaxOverview() {
    var categories = fetchAllTaxCategories();
    var rows       = [];
    var classLabelSet = {};
    var countryMap = {};
    var jurisSet   = {};
    var totalRates = 0;
    var ci;
    var ri;

    for (ci = 0; ci < categories.length; ci++) {
        var cat       = categories[ci];
        var classKey  = cat.key || cat.id || '';
        var className = getLocalized(cat.name) || classKey;
        var classLabel = className;
        if (classKey && classKey !== className) {
            classLabel = className + ' (' + classKey + ')';
        }
        if (classLabel) {
            classLabelSet[classLabel] = true;
        }

        var rates         = cat.rates || [];
        var rowCountryMap = {};
        totalRates += rates.length;

        for (ri = 0; ri < rates.length; ri++) {
            var rate    = rates[ri];
            var country = rate.country || '';
            if (!country) continue;

            var state = rate.state || '';
            jurisSet[country + '|' + (state || '-')] = true;

            var label = countryDisplayLabel(country);
            rowCountryMap[country] = label;
            countryMap[country] = label;
        }

        var countryLabels = [];
        var countryCodes  = Object.keys(rowCountryMap).sort();
        for (ri = 0; ri < countryCodes.length; ri++) {
            countryLabels.push(rowCountryMap[countryCodes[ri]]);
        }

        rows.push({
            classKey:       classKey,
            className:      className,
            classLabel:     classLabel || classKey,
            countryLabels:  countryLabels.join(', '),
            countries:      countryCodes,
            rateCount:      rates.length
        });
    }

    var allClassLabels = Object.keys(classLabelSet).sort();
    var allCountryLabels = [];
    var allCountryCodes = Object.keys(countryMap).sort();
    for (ci = 0; ci < allCountryCodes.length; ci++) {
        allCountryLabels.push(countryMap[allCountryCodes[ci]]);
    }

    return {
        rows:              rows,
        classLabels:       allClassLabels.join(', '),
        countryLabels:     allCountryLabels.join(', '),
        classCount:        categories.length,
        rateCount:         totalRates,
        jurisdictionCount: Object.keys(jurisSet).length
    };
}

/**
 * Summary for migration count endpoints.
 * @returns {{ classCount: number, rateCount: number, jurisdictionCount: number }}
 */
function getFullTaxSummary() {
    var overview = getTaxOverview();
    return {
        classCount:        overview.classCount,
        rateCount:         overview.rateCount,
        jurisdictionCount: overview.jurisdictionCount
    };
}

/**
 * Fetch all CTP tax categories (with embedded rates).
 * @returns {Array}
 */
function fetchAllTaxCategories() {
    var c      = cfg.ctp;
    var token  = getToken();
    var out    = [];
    var offset = 0;
    var limit  = 500;
    var batch;

    do {
        var qs = '?limit=' + limit + '&offset=' + offset + '&sort=id+asc&withTotal=true';
        var res = http.get(
            c.apiUrl + '/' + c.projectKey + '/tax-categories' + qs,
            { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
        );
        if (res.status !== 200) {
            failCtp('CTP tax-categories fetch failed', res);
        }
        batch = {
            results: res.data.results || [],
            total:   res.data.total   || 0
        };
        out = out.concat(batch.results);
        offset += batch.results.length;
    } while (batch.results.length === limit && offset < batch.total);

    return out;
}

/**
 * Count tax rates for a scope.
 * @param {string} scopeType - full|category|country
 * @param {string} [scopeId]
 * @returns {number}
 */
function getRateCount(scopeType, scopeId) {
    var categories = fetchAllTaxCategories();
    var total      = 0;
    var ci;
    var ri;

    for (ci = 0; ci < categories.length; ci++) {
        var cat    = categories[ci];
        var catKey = cat.key || cat.id || '';
        if (scopeType === 'category' && scopeId && scopeId !== 'full') {
            if (catKey !== scopeId && exportKeySafe(catKey) !== exportKeySafe(scopeId)) {
                continue;
            }
        }
        var rates = cat.rates || [];
        for (ri = 0; ri < rates.length; ri++) {
            var rate    = rates[ri];
            var country = rate.country || '';
            if (!country) continue;
            if (scopeType === 'country' && scopeId && country !== scopeId) continue;
            total++;
        }
    }
    return total;
}

module.exports = {
    fetchAllTaxCategories: fetchAllTaxCategories,
    getTaxOverview:        getTaxOverview,
    getFullTaxSummary:     getFullTaxSummary,
    getRateCount:          getRateCount,
    exportKeySafe:         exportKeySafe,
    countryDisplayLabel:   countryDisplayLabel
};
