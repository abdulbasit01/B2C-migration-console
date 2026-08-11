'use strict';

/**
 * Minimal page metadata middleware (no SFRA dependency).
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 * @returns {void}
 */
function computedPageMetaData(req, res, next) {
    var computedMetaData = {
        title: req.pageMetaData.title,
        description: req.pageMetaData.description,
        keywords: req.pageMetaData.keywords,
        pageMetaTags: []
    };

    req.pageMetaData.pageMetaTags.forEach(function (item) {
        if (item.title) {
            computedMetaData.title = item.content;
        } else if (item.name && item.ID === 'description') {
            computedMetaData.description = item.content;
        } else if (item.name && item.ID === 'keywords') {
            computedMetaData.keywords = item.content;
        } else {
            computedMetaData.pageMetaTags.push(item);
        }
    });

    res.setViewData({
        CurrentPageMetaData: computedMetaData
    });
    next();
}

module.exports = {
    computedPageMetaData: computedPageMetaData
};
