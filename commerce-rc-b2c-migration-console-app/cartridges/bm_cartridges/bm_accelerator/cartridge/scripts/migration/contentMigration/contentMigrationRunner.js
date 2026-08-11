'use strict';

var fileResolver = require('*/cartridge/scripts/migration/core/migrationFileResolver');
var fetcher      = require('*/cartridge/scripts/migration/contentMigration/amplienceContentFetcher');
var transformer  = require('*/cartridge/scripts/migration/contentMigration/amplienceContentTransformer');
var xmlBuilder   = require('*/cartridge/scripts/migration/contentMigration/contentXmlBuilder');
var metaBuilder  = require('*/cartridge/scripts/migration/contentMigration/contentMetaXmlBuilder');

var MODULE_KEY = 'content';
/** Keep small — each item is a sequential Amplience call inside BM request limits. */
var MAX_BATCH  = 5;

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

/**
 * @param {string} relDir
 * @param {string} fileName
 * @param {string} contents
 * @param {boolean} [append]
 * @returns {string}
 */
function writeFile(relDir, fileName, contents, append) {
    var File       = require('dw/io/File');
    var FileWriter = require('dw/io/FileWriter');
    var outFile = new File(File.IMPEX + File.SEPARATOR + relDir + File.SEPARATOR + fileName);
    var sw = new FileWriter(outFile, 'UTF-8', !!append);
    try {
        sw.write(contents);
    } finally {
        sw.close();
    }
    return fileName;
}

function readFile(relDir, fileName) {
    var File       = require('dw/io/File');
    var FileReader = require('dw/io/FileReader');
    var outFile = new File(File.IMPEX + File.SEPARATOR + relDir + File.SEPARATOR + fileName);
    if (!outFile.exists()) return '';
    var reader = new FileReader(outFile, 'UTF-8');
    var text = '';
    try {
        var line;
        while ((line = reader.readLine()) !== null) {
            text += line + '\n';
        }
    } finally {
        reader.close();
    }
    return text;
}

function normalizeIds(contentIds) {
    var ids = [];
    if (typeof contentIds === 'string') {
        ids = [contentIds];
    } else if (contentIds && contentIds.length) {
        ids = contentIds;
    }
    var out = [];
    var i;
    for (i = 0; i < ids.length; i++) {
        var id = String(ids[i] || '').trim();
        if (id) out.push(id);
    }
    return out;
}

function transformFetchedItems(fetchedItems) {
    var widgets = [];
    var i;
    for (i = 0; i < (fetchedItems || []).length; i++) {
        widgets.push(transformer.transformFetchedContent(fetchedItems[i]));
    }
    return widgets;
}

function collectContentTypes(widgets) {
    var seen = {};
    var types = [];
    var i;
    for (i = 0; i < (widgets || []).length; i++) {
        var widget = widgets[i];
        var schema = widget.schema || '';
        var shortName = widget.schemaShort || '';
        var key = shortName || schema;
        if (key && !seen[key]) {
            seen[key] = true;
            types.push({
                schema:        schema,
                schemaShort:   shortName,
                sfccComponent: widget.widgetType || ''
            });
        }
    }
    return types;
}

function buildSummary(widgets, contentIds, selection, errors) {
    var sample = [];
    var i;
    for (i = 0; i < widgets.length && sample.length < 5; i++) {
        sample.push({
            contentId:   widgets[i].contentId || '',
            deliveryKey: widgets[i].deliveryKey || '',
            widgetType:  widgets[i].widgetType || '',
            schemaShort: widgets[i].schemaShort || '',
            title:       (widgets[i].preview && widgets[i].preview.title) || ''
        });
    }
    return {
        generatedAt:    new Date().toISOString(),
        selection:      selection || {},
        totalRequested: (contentIds || []).length,
        totalFetched:   widgets.length,
        failed:         (errors || []).length,
        contentTypes:   collectContentTypes(widgets),
        sample:         sample,
        errors:         errors || []
    };
}

/**
 * Build asset XML fragments for a widget batch.
 * @param {Object[]} widgets
 * @returns {{ xml: string, ids: string[] }}
 */
function buildAssetFragments(widgets) {
    var assetParts = [];
    var ids = [];
    var i;
    for (i = 0; i < (widgets || []).length; i++) {
        if (!widgets[i]) continue;
        assetParts.push(xmlBuilder.buildContentAssetXml(widgets[i]));
        ids.push(xmlBuilder.sanitizeContentId(widgets[i]));
    }
    return {
        xml: assetParts.length ? assetParts.join('\n') + '\n' : '',
        ids: ids
    };
}

/**
 * Write or stream-append library XML. Avoids re-reading the whole file each batch.
 * @param {Object[]} widgets
 * @param {string} [libraryId]
 * @param {string} [appendFile]
 * @param {boolean} [finalize] - write closing </library> (default true when not appending)
 * @returns {Object}
 */
function writeWidgetsXml(widgets, libraryId, appendFile, finalize) {
    var relDir = ensureDir();
    var contentFileName;
    var metaFileName;
    var fragments = buildAssetFragments(widgets);
    var closeLibrary = finalize === true || (finalize !== false && !appendFile);
    var libId = xmlBuilder.resolveLibraryId(libraryId);

    if (appendFile) {
        contentFileName = String(appendFile);
        // Stream-append only — never re-read/rewrite the growing XML (that caused BM timeouts).
        writeFile(
            relDir,
            contentFileName,
            fragments.xml + (closeLibrary ? '</library>\n' : ''),
            true
        );
        metaFileName = contentFileName.replace(/\.xml$/, '-meta.xml');
        if (metaFileName === contentFileName) metaFileName = 'content-meta.xml';
        var File = require('dw/io/File');
        var metaPath = new File(File.IMPEX + File.SEPARATOR + relDir + File.SEPARATOR + metaFileName);
        if (!metaPath.exists()) {
            writeFile(relDir, metaFileName, metaBuilder.buildMetaXml());
        }
        return {
            ok:           true,
            built:        fragments.ids.length,
            contentIds:   fragments.ids,
            libraryId:    libId,
            fileName:     contentFileName,
            metaFileName: metaFileName,
            fileNames:    [metaFileName, contentFileName],
            appended:     true,
            finalized:    closeLibrary,
            impexPath:    fileResolver.getRelativePath(MODULE_KEY)
        };
    }

    var catalogResult = xmlBuilder.buildXml(widgets, libraryId, { close: closeLibrary });
    contentFileName = fileResolver.resolveXmlFileName(MODULE_KEY, 0, 1, 'local');
    metaFileName = contentFileName.replace(/\.xml$/, '-meta.xml');
    if (metaFileName === contentFileName) {
        metaFileName = 'content-meta.xml';
    }

    writeFile(relDir, contentFileName, catalogResult.xml);
    writeFile(relDir, metaFileName, metaBuilder.buildMetaXml());

    return {
        ok:           true,
        built:        catalogResult.built,
        contentIds:   catalogResult.contentIds,
        libraryId:    catalogResult.libraryId,
        fileName:     contentFileName,
        metaFileName: metaFileName,
        fileNames:    [metaFileName, contentFileName],
        appended:     false,
        finalized:    closeLibrary,
        impexPath:    fileResolver.getRelativePath(MODULE_KEY)
    };
}

function appendPreviewJson(fileName, widgets, selection, errors, totalRequested) {
    var relDir = ensureDir();
    var existingText = fileName ? readFile(relDir, fileName) : '';
    var preview;
    try {
        preview = existingText ? JSON.parse(existingText) : null;
    } catch (e) {
        preview = null;
    }
    if (!preview || typeof preview !== 'object') {
        preview = {
            generatedAt:    new Date().toISOString(),
            selection:      selection || {},
            totalRequested: totalRequested || widgets.length,
            totalFetched:   0,
            failed:         0,
            contentTypes:   [],
            items:          [],
            errors:         []
        };
        fileName = fileResolver.resolveXmlFileName(MODULE_KEY, 0, 1, 'local').replace(/\.xml$/, '-preview.json');
    }

    var i;
    for (i = 0; i < widgets.length; i++) {
        preview.items.push(widgets[i]);
    }
    for (i = 0; i < (errors || []).length; i++) {
        preview.errors.push(errors[i]);
    }
    preview.totalFetched = preview.items.length;
    preview.failed = preview.errors.length;
    preview.contentTypes = collectContentTypes(preview.items);
    preview.selection = selection || preview.selection || {};
    writeFile(relDir, fileName, JSON.stringify(preview, null, 2));
    return {
        fileName: fileName,
        summary:  buildSummary(preview.items, null, preview.selection, preview.errors)
    };
}

/**
 * Generate library JSON preview for a batch of content ids.
 * Full payload is written to IMPEX; response carries a compact summary only.
 * @param {string[]} contentIds
 * @param {Object} [selection]
 * @param {Object} [opts]
 * @returns {Object}
 */
function previewByContentIds(contentIds, selection, opts) {
    var ids = normalizeIds(contentIds);
    if (!ids.length) {
        return { ok: false, error: 'At least one content id is required.' };
    }
    if (ids.length > MAX_BATCH) {
        return {
            ok: false,
            error: 'Preview batch limited to ' + MAX_BATCH + ' items. Send smaller batches.'
        };
    }

    var options = opts || {};
    var fetchedResult = fetcher.fetchByContentIds(ids);
    var widgets = transformFetchedItems(fetchedResult.items);
    if (!widgets.length && !options.appendFile) {
        return {
            ok:     false,
            error:  fetchedResult.errors.length ? fetchedResult.errors[0].error : 'No content previewed.',
            errors: fetchedResult.errors
        };
    }

    var written = appendPreviewJson(
        options.appendFile || '',
        widgets,
        selection,
        fetchedResult.errors,
        options.totalRequested || ids.length
    );

    return {
        ok:        true,
        summary:   written.summary,
        fileName:  written.fileName,
        built:     widgets.length,
        failed:    fetchedResult.errors.length,
        errors:    fetchedResult.errors,
        batchSize: MAX_BATCH,
        impexPath: fileResolver.getRelativePath(MODULE_KEY)
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

    var result = writeWidgetsXml(widgets, libraryId, '');
    result.failed = errors.length;
    result.errors = errors;
    return result;
}

/**
 * Fetch Amplience content by management content-item id(s).
 * @param {string|string[]} contentIds
 * @param {string} [libraryId]
 * @param {Object} [opts]
 * @returns {Object}
 */
function exportByContentIds(contentIds, libraryId, opts) {
    var ids = normalizeIds(contentIds);
    var options = opts || {};
    var finalize = options.finalize !== false;
    var appendFile = options.appendFile || '';

    // Allow an empty finalize-only call to close an open multi-batch file.
    if (!ids.length) {
        if (appendFile && finalize) {
            var closed = writeWidgetsXml([], libraryId, appendFile, true);
            closed.failed = 0;
            closed.errors = [];
            closed.batchSize = MAX_BATCH;
            return closed;
        }
        return { ok: false, error: 'At least one content id is required.' };
    }
    if (ids.length > MAX_BATCH) {
        return {
            ok: false,
            error: 'Export batch limited to ' + MAX_BATCH + ' items. Send smaller batches.'
        };
    }

    var fetchedResult = fetcher.fetchByContentIds(ids);
    var widgets = transformFetchedItems(fetchedResult.items);
    var errors = fetchedResult.errors;

    if (!widgets.length && !appendFile) {
        return {
            ok:     false,
            error:  errors.length ? errors[0].error : 'No content exported.',
            errors: errors
        };
    }

    if (!widgets.length) {
        if (finalize && appendFile) {
            var emptyFinalize = writeWidgetsXml([], libraryId, appendFile, true);
            emptyFinalize.failed = errors.length;
            emptyFinalize.errors = errors;
            emptyFinalize.batchSize = MAX_BATCH;
            return emptyFinalize;
        }
        return {
            ok:           true,
            built:        0,
            failed:       errors.length,
            errors:       errors,
            fileName:     appendFile,
            metaFileName: appendFile
                ? String(appendFile).replace(/\.xml$/, '-meta.xml')
                : '',
            fileNames:    [],
            batchSize:    MAX_BATCH,
            impexPath:    fileResolver.getRelativePath(MODULE_KEY)
        };
    }

    var result = writeWidgetsXml(widgets, libraryId, appendFile, finalize);
    result.failed = errors.length;
    result.errors = errors;
    result.batchSize = MAX_BATCH;
    return result;
}

module.exports = {
    MAX_BATCH:            MAX_BATCH,
    exportByDeliveryKeys: exportByDeliveryKeys,
    exportByContentIds:   exportByContentIds,
    previewByContentIds:  previewByContentIds
};
