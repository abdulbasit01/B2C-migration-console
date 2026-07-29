'use strict';

var prefs = {};

module.exports = {
    getCurrent: function () {
        return {
            getCustomPreferenceValue: function (key) {
                return Object.prototype.hasOwnProperty.call(prefs, key) ? prefs[key] : null;
            }
        };
    },
    __setPreference: function (key, value) {
        prefs[key] = value;
    },
    __reset: function () {
        prefs = {};
    }
};
