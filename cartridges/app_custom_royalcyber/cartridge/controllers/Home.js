'use strict';

/**
 * Royal Cyber Home — always render SFRA home/homePage.isml.
 * Base Home-Show prefers Page Designer page ID "homepage" when visible,
 * which hides the custom hero / category blocks.
 */
var server = require('server');
var cache = require('*/cartridge/scripts/middleware/cache');
var consentTracking = require('*/cartridge/scripts/middleware/consentTracking');
var pageMetaData = require('*/cartridge/scripts/middleware/pageMetaData');

server.extend(module.superModule);

server.replace('Show', consentTracking.consent, cache.applyDefaultCache, function (req, res, next) {
    var Site = require('dw/system/Site');
    var pageMetaHelper = require('*/cartridge/scripts/helpers/pageMetaHelper');

    pageMetaHelper.setPageMetaTags(req.pageMetaData, Site.current);
    res.render('home/homePage');
    next();
}, pageMetaData.computedPageMetaData);

module.exports = server.exports();
