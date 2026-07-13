'use strict';

var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var fetcher      = require('*/cartridge/scripts/migration/contentMigration/amplienceContentFetcher');
var transformer  = require('*/cartridge/scripts/migration/contentMigration/amplienceContentTransformer');
var xmlBuilder   = require('*/cartridge/scripts/migration/contentMigration/contentXmlBuilder');
var metaBuilder  = require('*/cartridge/scripts/migration/contentMigration/contentMetaXmlBuilder');

var MODULE_KEY = 'content';

function ensureDir() {
    var File  = require('dw/io/File');
    var paths = require('*/cartridge/scripts/migration/core/migrationPaths');
    var relDir = paths.getRelativePath(MODULE_KEY).replace(/\//g, File.SEPARATOR);
    var dir = new File(File.IMPEX + File.SEPARATOR + relDir);
    if (!dir.exists()) {
        dir.mkdirs();
    }
    return relDir;
}

function writeFile(relDir, fileName, contents) {
    var File       = require('dw/io/File');
    var FileWriter = require('dw/io/FileWriter');
    var outFile = new File(File.IMPEX + File.SEPARATOR + relDir + File.SEPARATOR + fileName);
    var sw = new FileWriter(outFile, 'UTF-8', false);
    try {
        sw.write(contents);
    } finally {
        sw.close();
    }
    return fileName;
}

function writeWidgetsXml(widgets, libraryId) {
    var catalogResult = xmlBuilder.buildXml(widgets, libraryId);
    var contentFileName = fileResolver.resolveXmlFileName(MODULE_KEY, 0, 1, 'local');
    var metaFileName = contentFileName.replace(/\.xml$/, '-meta.xml');
    if (metaFileName === contentFileName) {
        metaFileName = 'content-meta.xml';
    }

    var relDir = ensureDir();
    writeFile(relDir, contentFileName, catalogResult.xml);
    writeFile(relDir, metaFileName, metaBuilder.buildMetaXml());

    return {
        ok:             true,
        built:          catalogResult.built,
        contentIds:     catalogResult.contentIds,
        libraryId:      catalogResult.libraryId,
        fileName:       contentFileName,
        metaFileName:   metaFileName,
        fileNames:      [metaFileName, contentFileName],
        impexPath:      fileResolver.getRelativePath(MODULE_KEY)
    };
}

/**
 * Fetch Amplience content by delivery key(s), map to widgets, write library IMPEX XML.
 * @param {string|string[]} deliveryKeys
 * @param {string} [libraryId]
 * @returns {Object}
 */
function exportByDeliveryKeys(deliveryKeys, libraryId) {
    var keys = [];
    if (typeof deliveryKeys === 'string') {
        keys = [deliveryKeys];
    } else if (deliveryKeys && deliveryKeys.length) {
        keys = deliveryKeys;
    }

    if (!keys.length) {
        return { ok: false, error: 'At least one delivery key is required.' };
    }

    var widgets = [];
    var errors  = [];
    var i;
    for (i = 0; i < keys.length; i++) {
        var key = String(keys[i] || '').trim();
        if (!key) continue;
        try {
            var fetched = fetcher.fetchByDeliveryKey(key);
            widgets.push(transformer.transformFetchedContent(fetched));
        } catch (e) {
            errors.push({ deliveryKey: key, error: e.message || String(e) });
        }
    }

    if (!widgets.length) {
        return {
            ok:     false,
            error:  errors.length ? errors[0].error : 'No content exported.',
            errors: errors
        };
    }

    var result = writeWidgetsXml(widgets, libraryId);
    result.failed = errors.length;
    result.errors = errors;
    return result;
}

/**
 * Fetch Amplience content by management content-item id(s).
 * @param {string|string[]} contentIds
 * @param {string} [libraryId]
 * @returns {Object}
 */
function exportByContentIds(contentIds, libraryId) {
    var ids = [];
    if (typeof contentIds === 'string') {
        ids = [contentIds];
    } else if (contentIds && contentIds.length) {
        ids = contentIds;
    }

    if (!ids.length) {
        return { ok: false, error: 'At least one content id is required.' };
    }

    var widgets = [];
    var errors  = [];
    var i;
    for (i = 0; i < ids.length; i++) {
        var id = String(ids[i] || '').trim();
        if (!id) continue;
        try {
            var fetched = fetcher.fetchByContentId(id);
            widgets.push(transformer.transformFetchedContent(fetched));
        } catch (e) {
            errors.push({ contentId: id, error: e.message || String(e) });
        }
    }

    if (!widgets.length) {
        return {
            ok:     false,
            error:  errors.length ? errors[0].error : 'No content exported.',
            errors: errors
        };
    }

    var result = writeWidgetsXml(widgets, libraryId);
    result.failed = errors.length;
    result.errors = errors;
    return result;
}

module.exports = {
    exportByDeliveryKeys: exportByDeliveryKeys,
    exportByContentIds:   exportByContentIds
};
