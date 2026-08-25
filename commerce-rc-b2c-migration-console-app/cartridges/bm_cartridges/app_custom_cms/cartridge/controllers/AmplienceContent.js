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
    var query = String(req.querystring.q || '').trim();

    req.pageMetaData.setTitle('Amplience Content');
    req.pageMetaData.setDescription('Live Amplience content component gallery');

    if (type && !allowedTypes[type]) type = '';

    var view = String(req.querystring.view || '').toLowerCase();
    if (view !== 'list' && view !== 'grid') {
        view = 'list';
    }

    var result = helper.getAmplienceAssets({
        page: req.querystring.page,
        pageSize: 12,
        type: type,
        query: query
    });
    result.view = view;

    res.setViewData({
        amplience: result,
        liveEnabled: helper.isLiveContentEnabled(),
        hubConfigured: !!helper.getHubName(null, {}),
        widgetTypes: helper.getWidgetTypeFilters()
    });
    res.render('amplience/contentGallery');
    next();
}, pageMetaData.computedPageMetaData);

/**
 * AmplienceContent-List : JSON catalog for storefront galleries (SFCC + React).
 */
server.get('List', applyNoPageCache, function (req, res, next) {
    var helper = require('*/cartridge/scripts/helpers/amplienceContent');
    var type = String(req.querystring.type || '');
    var query = String(req.querystring.q || '').trim();

    try {
        if (type && !helper.WIDGET_TYPES[type]) type = '';

        var result = helper.getAmplienceAssets({
            page: req.querystring.page,
            pageSize: req.querystring.pageSize || 48,
            type: type,
            query: query
        });

        var items = [];
        var i;
        for (i = 0; i < result.items.length; i++) {
            var item = result.items[i];
            items.push({
                id: item.id,
                name: item.name,
                description: item.description || '',
                widgetType: item.widgetType,
                widgetLabel: item.widgetLabel,
                contentId: item.contentId,
                deliveryKey: item.deliveryKey,
                imageUrl: item.imageUrl || ''
            });
        }

        res.json({
            ok: true,
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            pageCount: result.pageCount,
            hasPrevious: result.hasPrevious,
            hasNext: result.hasNext,
            type: result.type,
            query: result.query,
            folderFound: result.folderFound,
            widgetTypes: helper.getWidgetTypeFilters(),
            items: items
        });
    } catch (e) {
        res.setStatusCode(500);
        res.json({
            ok: false,
            error: String(e.message || e)
        });
    }
    return next();
});

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

/**
 * AmplienceContent-Preview : JSON preview fragment for gallery locale switching.
 * One cached CDN call per card/locale (not per gallery page).
 */
server.get('Preview', applyNoPageCache, function (req, res, next) {
    var helper = require('*/cartridge/scripts/helpers/amplienceContent');
    var locale = String(req.querystring.locale || '').trim();

    try {
        var payload = helper.getGalleryPreviewForLocale(req.querystring.cid, locale);
        if (!payload.ok) {
            res.setStatusCode(404);
        }
        res.json(payload);
    } catch (e) {
        res.setStatusCode(500);
        res.json({
            ok: false,
            error: String(e.message || e)
        });
    }
    return next();
});

/**
 * AmplienceContent-Compose : stack multiple migrated components on one page.
 * Example: ?cids=amp-hero-id,amp-rich-text-id
 */
server.get('Compose', applyNoPageCache, function (req, res, next) {
    var helper = require('*/cartridge/scripts/helpers/amplienceContent');
    var cids = String(req.querystring.cids || '');
    var live = String(req.querystring.live || '') === '1';
    var items = helper.getAmplienceComposePage(cids, { live: live });

    req.pageMetaData.setTitle('Amplience Page');
    req.pageMetaData.setDescription('Composed Amplience content page');
    res.setViewData({
        items: items,
        cids: cids,
        hubConfigured: !!helper.getHubName(null, {})
    });
    res.render('amplience/contentCompose');
    return next();
}, pageMetaData.computedPageMetaData);

module.exports = server.exports();
