'use strict';

// Please check all available configurations and rules
// at https://www.npmjs.com/package/isml-linter.

var config = {
    rootDir: 'commerce-rc-b2c-migration-console-app/cartridges/bm_cartridges',
    enableCache: true,
    rules: {
        'no-space-only-lines': {},
        'no-tabs': {},
        'no-trailing-spaces': {}
    },
};

module.exports = config;
