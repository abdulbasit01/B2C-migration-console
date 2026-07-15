'use strict';

var registry = {};

function ContentMgr() {}

ContentMgr.getContent = function (id) {
    return registry[id] || null;
};

ContentMgr.__setContent = function (id, asset) {
    registry[id] = asset;
};

ContentMgr.__reset = function () {
    registry = {};
};

module.exports = ContentMgr;
