'use strict';

var ContentMgr = require('dw/content/ContentMgr');

var FOLDER_ID = 'amplience';

/**
 * Convert an SFCC collection or JavaScript array to an array.
 * @param {dw.util.Collection|Array} collection - Content collection
 * @returns {Array} Array values
 */
function collectionToArray(collection) {
    var result = [];
    var iterator;
    var i;

    if (!collection) return result;
    if (collection.iterator) {
        iterator = collection.iterator();
        while (iterator.hasNext()) result.push(iterator.next());
        return result;
    }
    if (typeof collection.length === 'number') {
        for (i = 0; i < collection.length; i++) result.push(collection[i]);
    }
    return result;
}

/**
 * Collect Amplience refs from migrated SFCC content assets.
 * @param {string} [folderId] - SFCC content folder ID
 * @returns {Object} Ref summary for re-sync export
 */
function listMigratedRefs(folderId) {
    var folder = ContentMgr.getFolder(folderId || FOLDER_ID);
    if (!folder) {
        return {
            ok: false,
            error: 'Folder "' + (folderId || FOLDER_ID) + '" was not found in the current library.',
            folderId: folderId || FOLDER_ID,
            contentIds: [],
            deliveryKeys: [],
            total: 0
        };
    }

    var content = typeof folder.getOnlineContent === 'function'
        ? folder.getOnlineContent()
        : folder.onlineContent;
    var assets = collectionToArray(content);
    var contentIds = [];
    var deliveryKeys = [];
    var seenIds = {};
    var seenKeys = {};
    var i;
    var asset;
    var custom;
    var contentId;
    var deliveryKey;

    for (i = 0; i < assets.length; i++) {
        asset = assets[i];
        if (!asset || asset.online === false || !asset.custom) continue;

        custom = asset.custom;
        contentId = String(custom.amplienceContentId || '').trim();
        deliveryKey = String(custom.amplienceDeliveryKey || '').trim();

        if (contentId && !seenIds[contentId]) {
            seenIds[contentId] = true;
            contentIds.push(contentId);
        } else if (deliveryKey && !seenKeys[deliveryKey]) {
            seenKeys[deliveryKey] = true;
            deliveryKeys.push(deliveryKey);
        }
    }

    return {
        ok: true,
        folderId: folderId || FOLDER_ID,
        folderName: folder.displayName || folder.ID,
        contentIds: contentIds,
        deliveryKeys: deliveryKeys,
        total: contentIds.length + deliveryKeys.length
    };
}

module.exports = {
    FOLDER_ID: FOLDER_ID,
    listMigratedRefs: listMigratedRefs
};
