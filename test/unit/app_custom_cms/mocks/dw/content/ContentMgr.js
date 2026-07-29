'use strict';

var registry = {};
var folders = {};

function ContentMgr() {}

ContentMgr.getContent = function (id) {
    return registry[id] || null;
};

ContentMgr.getFolder = function (id) {
    return folders[id] || null;
};

ContentMgr.__setContent = function (id, asset) {
    registry[id] = asset;
};

ContentMgr.__setFolder = function (id, folder) {
    folders[id] = folder;
};

ContentMgr.__reset = function () {
    registry = {};
    folders = {};
};

module.exports = ContentMgr;
