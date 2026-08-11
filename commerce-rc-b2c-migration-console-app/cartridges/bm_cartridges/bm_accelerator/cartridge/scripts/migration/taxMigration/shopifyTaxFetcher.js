'use strict';

var shopifyApi = require('*/cartridge/scripts/migration/core/shopifyApi');

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

function exportKeySafe(key) {
    return String(key || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function countryDisplayLabel(code) {
    if (!code) return '';
    var upper = String(code).trim().toUpperCase();
    var name  = COUNTRY_NAMES[upper];
    return name ? (upper + ' (' + name + ')') : upper;
}

function normalizeTaxAmount(tax) {
    if (tax === null || tax === undefined || tax === '') return 0;
    var n = Number(tax);
    return isNaN(n) ? 0 : n;
}

function hasConfiguredProvinceTax(provinces) {
    var pi;
    for (pi = 0; pi < provinces.length; pi++) {
        if (normalizeTaxAmount(provinces[pi].tax) > 0) {
            return true;
        }
    }
    return false;
}

function shopifyCountriesToCategories(countries) {
    var standardRates = [];
    var ci;
    var pi;

    for (ci = 0; ci < countries.length; ci++) {
        var country   = countries[ci];
        var code      = country.code || country.iso || '';
        if (!code) continue;

        var provinces = country.provinces || [];
        if (provinces.length && hasConfiguredProvinceTax(provinces)) {
            for (pi = 0; pi < provinces.length; pi++) {
                var prov = provinces[pi];
                standardRates.push({
                    country: code,
                    state:   prov.code || prov.name || '',
                    amount:  normalizeTaxAmount(prov.tax)
                });
            }
        } else {
            standardRates.push({
                country: code,
                state:   '',
                amount:  normalizeTaxAmount(country.tax)
            });
        }
    }

    return [{
        id:    'shopify-standard',
        key:   'standard',
        name:  { en: 'Standard' },
        rates: standardRates
    }];
}

/**
 * @returns {Array}
 */
function fetchAllTaxCategories() {
    var res       = shopifyApi.get('/countries.json');
    var countries = res.data.countries || [];
    return shopifyCountriesToCategories(countries);
}

function getTaxOverview() {
    var categories = fetchAllTaxCategories();
    var rows       = [];
    var classLabelSet = {};
    var countryMap = {};
    var jurisSet   = {};
    var totalRates = 0;
    var nonZeroRates = 0;
    var ci;
    var ri;

    for (ci = 0; ci < categories.length; ci++) {
        var cat       = categories[ci];
        var classKey  = cat.key || cat.id || '';
        var className = 'Standard';
        var classLabel = className + ' (' + classKey + ')';
        classLabelSet[classLabel] = true;

        var rates         = cat.rates || [];
        var rowCountryMap = {};
        var rowNonZero    = 0;
        totalRates += rates.length;

        for (ri = 0; ri < rates.length; ri++) {
            var rate    = rates[ri];
            var country = rate.country || '';
            if (!country) continue;
            if (normalizeTaxAmount(rate.amount) > 0) {
                nonZeroRates++;
                rowNonZero++;
            }
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
            classLabel:     classLabel,
            countryLabels:  countryLabels.join(', '),
            countries:      countryCodes,
            rateCount:      rates.length,
            nonZeroRateCount: rowNonZero
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
        nonZeroRateCount:  nonZeroRates,
        jurisdictionCount: Object.keys(jurisSet).length
    };
}

function getFullTaxSummary() {
    var overview = getTaxOverview();
    return {
        classCount:        overview.classCount,
        rateCount:         overview.rateCount,
        nonZeroRateCount:  overview.nonZeroRateCount,
        jurisdictionCount: overview.jurisdictionCount
    };
}

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
