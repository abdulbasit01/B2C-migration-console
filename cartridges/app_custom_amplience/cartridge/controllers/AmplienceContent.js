'use strict';

var server = require('server');
var cache = require('*/cartridge/scripts/middleware/cache');
var pageMetaData = require('*/cartridge/scripts/middleware/pageMetaData');

server.get(
    'Include',
    server.middleware.include,
    cache.applyDefaultCache,
    function (req, res, next) {
        var helper = require('*/cartridge/scripts/helpers/amplienceContent');
        var asset = helper.getAmplienceAsset(req.querystring.cid);

        if (asset) {
            res.render('components/content/amplienceAsset', { amp: asset });
        }
        next();
    }
);

server.get('Show', cache.applyDefaultCache, function (req, res, next) {
    var helper = require('*/cartridge/scripts/helpers/amplienceContent');
    var allowedTypes = helper.WIDGET_TYPES;
    var type = String(req.querystring.type || '');

    req.pageMetaData.setTitle('Amplience Content');
    req.pageMetaData.setDescription('Migrated Amplience content component gallery');

    if (type && !allowedTypes[type]) type = '';

    var result = helper.getAmplienceAssets({
        page: req.querystring.page,
        pageSize: 12,
        type: type
    });

    res.setViewData({
        amplience: result,
        widgetTypes: [
            { id: '', label: 'All components' },
            { id: 'mainBanner', label: 'Main banners' },
            { id: 'campaignBanner', label: 'Campaign banners' },
            { id: 'imageAndText', label: 'Image and text' },
            { id: 'editorialRichText', label: 'Editorial rich text' },
            { id: 'amplienceWidget', label: 'Generic widgets' }
        ]
    });
    res.render('amplience/contentGallery');
    next();
}, pageMetaData.computedPageMetaData);

server.get('Detail', cache.applyDefaultCache, function (req, res, next) {
    var helper = require('*/cartridge/scripts/helpers/amplienceContent');
    var asset = helper.getAmplienceAsset(req.querystring.cid);

    if (!asset) {
        res.setStatusCode(404);
        res.render('error/notFound');
        return next();
    }

    req.pageMetaData.setTitle(asset.name);
    req.pageMetaData.setDescription(asset.description || 'Migrated Amplience content');
    res.setViewData({ amp: asset });
    res.render('amplience/contentDetail');
    return next();
}, pageMetaData.computedPageMetaData);

module.exports = server.exports();
