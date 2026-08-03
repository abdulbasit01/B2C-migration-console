'use strict';

var bigcommerceApi = require('*/cartridge/scripts/migration/core/bigcommerceApi');

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

/**
 * Collect country codes from shipping zones (best-effort jurisdiction list).
 * @returns {string[]}
 */
function collectShippingZoneCountries() {
    var countries = {};
    var zones     = [];
    try {
        zones = bigcommerceApi.fetchAll('/shipping/zones', null, {
            version: 'v2',
            limit:   250
        });
    } catch (e) {
        return [];
    }

    var zi;
    for (zi = 0; zi < zones.length; zi++) {
        var locs = zones[zi].locations || [];
        var li;
        for (li = 0; li < locs.length; li++) {
            var code = locs[li].country_iso2 || locs[li].country_iso || locs[li].country_code || '';
            if (code) countries[String(code).toUpperCase()] = true;
        }
    }
    return Object.keys(countries).sort();
}

/**
 * Map BigCommerce tax classes + shipping-zone countries to CTP-like tax categories.
 * Rates default to 0 when no rate API is available.
 * @returns {Array}
 */
function fetchAllTaxCategories() {
    var taxClasses = [];
    try {
        taxClasses = bigcommerceApi.fetchAll('/tax_classes', null, {
            version: 'v2',
            limit:   250
        });
    } catch (e1) {
        taxClasses = [];
    }

    var countries = collectShippingZoneCountries();
    if (!countries.length) {
        try {
            var store = bigcommerceApi.getStore();
            if (store && store.country_code) {
                countries = [String(store.country_code).toUpperCase()];
            }
        } catch (e2) { /* ignore */ }
    }

    var standardRates = [];
    var ci;
    for (ci = 0; ci < countries.length; ci++) {
        standardRates.push({
            country: countries[ci],
            state:   '',
            amount:  0
        });
    }

    if (!taxClasses.length) {
        return [{
            id:    'bc-standard',
            key:   'standard',
            name:  { en: 'Standard' },
            rates: standardRates
        }];
    }

    var out = [];
    var ti;
    for (ti = 0; ti < taxClasses.length; ti++) {
        var tc   = taxClasses[ti];
        var id   = tc.id != null ? String(tc.id) : String(ti);
        var name = tc.name || ('Tax Class ' + id);
        var key  = exportKeySafe(name).toLowerCase() || ('tax_' + id);
        out.push({
            id:    'bc-tax-' + id,
            key:   key,
            name:  { en: name },
            rates: standardRates.slice()
        });
    }
    return out;
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
        var cat        = categories[ci];
        var classKey   = cat.key || cat.id || '';
        var className  = (cat.name && (cat.name.en || cat.name['en-US'])) || classKey || 'Standard';
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
            classKey:         classKey,
            className:        className,
            classLabel:       classLabel,
            countryLabels:    countryLabels.join(', '),
            countries:        countryCodes,
            rateCount:        rates.length,
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
