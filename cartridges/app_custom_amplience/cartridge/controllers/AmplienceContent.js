'use strict';

var server = require('server');
var pageMetaData = require('*/cartridge/scripts/middleware/pageMetaData');

/**
 * Do not page-cache live Amplience HTML — editors republish often.
 * A short CacheMgr TTL (60s) still protects HTTPClient quota.
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function applyNoPageCache(req, res, next) {
    res.cachePeriod = 0;
    res.cachePeriodUnit = 'minutes';
    next();
}

/**
 * AmplienceContent-Include : remote include for one live component card.
 */
server.get(
    'Include',
    server.middleware.include,
    applyNoPageCache,
    function (req, res, next) {
        var helper = require('*/cartridge/scripts/helpers/amplienceContent');
        var bypass = String(req.querystring.nocache || '') === '1';
        var asset = helper.getAmplienceAsset(req.querystring.cid, {
            live: true,
            bypassCache: bypass
        });

        if (asset) {
            res.render('components/content/amplienceAsset', { amp: asset });
        }
        next();
    }
);

/**
 * AmplienceContent-Show : gallery shell (list only). Bodies load live via Includes.
 */
server.get('Show', applyNoPageCache, function (req, res, next) {
    var helper = require('*/cartridge/scripts/helpers/amplienceContent');
    var allowedTypes = helper.WIDGET_TYPES;
    var type = String(req.querystring.type || '');
    var nocache = String(req.querystring.nocache || '') === '1';

    req.pageMetaData.setTitle('Amplience Content');
    req.pageMetaData.setDescription('Live Amplience content component gallery');

    if (type && !allowedTypes[type]) type = '';

    var result = helper.getAmplienceAssets({
        page: req.querystring.page,
        pageSize: 12,
        type: type
    });

    res.setViewData({
        amplience: result,
        liveEnabled: helper.isLiveContentEnabled(),
        hubConfigured: !!helper.getHubName(null, {}),
        nocache: nocache,
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

/**
 * AmplienceContent-Detail : always live Amplience CDN content when possible.
 */
server.get('Detail', applyNoPageCache, function (req, res, next) {
    var helper = require('*/cartridge/scripts/helpers/amplienceContent');
    var bypass = String(req.querystring.nocache || '') === '1';
    var asset = helper.getAmplienceAsset(req.querystring.cid, {
        live: true,
        bypassCache: bypass
    });

    if (!asset) {
        res.setStatusCode(404);
        res.render('error/notFound');
        return next();
    }

    req.pageMetaData.setTitle(asset.name);
    req.pageMetaData.setDescription(asset.description || 'Amplience content');
    res.setViewData({
        amp: asset,
        liveEnabled: helper.isLiveContentEnabled(),
        hubConfigured: !!helper.getHubName(null, asset.attributes || {})
    });
    res.render('amplience/contentDetail');
    return next();
}, pageMetaData.computedPageMetaData);

module.exports = server.exports();
