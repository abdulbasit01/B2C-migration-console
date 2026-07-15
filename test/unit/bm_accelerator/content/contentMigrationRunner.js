'use strict';

/* global describe, it */

var expect = require('chai').expect;
var path = require('path');
var proxyquire = require('proxyquire').noCallThru();

var runnerPath = path.join(
    __dirname,
    '../../../../cartridges/bm_accelerator/cartridge/scripts/migration/contentMigration/contentMigrationRunner.js'
);

describe('Amplience content migration runner', function () {
    it('stream-appends batches and closes library only on finalize', function () {
        var files = {};

        /**
         * Minimal in-memory dw.io.File test double.
         * @param {string} filePath - IMPEX path
         */
        function File(filePath) {
            this.path = filePath;
        }
        File.IMPEX = '/impex';
        File.SEPARATOR = '/';
        File.prototype.exists = function () {
            return Object.prototype.hasOwnProperty.call(files, this.path);
        };
        File.prototype.mkdirs = function () {
            files[this.path] = files[this.path] || '';
        };

        /**
         * Minimal in-memory FileWriter test double.
         * @param {File} file - target file
         * @param {string} encoding - charset
         * @param {boolean} append - append mode
         */
        function FileWriter(file, encoding, append) {
            this.file = file;
            this.append = !!append;
        }
        FileWriter.prototype.write = function (contents) {
            if (this.append && Object.prototype.hasOwnProperty.call(files, this.file.path)) {
                files[this.file.path] += contents;
            } else {
                files[this.file.path] = contents;
            }
        };
        FileWriter.prototype.close = function () {};

        /**
         * Minimal in-memory FileReader test double.
         * @param {File} file - source file
         */
        function FileReader(file) {
            this.lines = String(files[file.path] || '').split(/\r?\n/);
            this.index = 0;
        }
        FileReader.prototype.readLine = function () {
            if (this.index >= this.lines.length) return null;
            var line = this.lines[this.index];
            this.index += 1;
            return line;
        };
        FileReader.prototype.close = function () {};

        var runner = proxyquire(runnerPath, {
            '*/cartridge/scripts/migration/core/migrationFileResolver': {
                resolveXmlFileName: function () { return 'content-test.xml'; },
                getRelativePath: function () { return 'src/migration/content'; }
            },
            '*/cartridge/scripts/migration/contentMigration/amplienceContentFetcher': {
                fetchByContentIds: function (ids) {
                    return {
                        items: ids.map(function (id) { return { contentId: id }; }),
                        errors: []
                    };
                }
            },
            '*/cartridge/scripts/migration/contentMigration/amplienceContentTransformer': {
                transformFetchedContent: function (item) {
                    return { contentId: item.contentId };
                }
            },
            '*/cartridge/scripts/migration/contentMigration/contentXmlBuilder': {
                buildXml: function (widgets, libraryId, opts) {
                    var close = !opts || opts.close !== false;
                    return {
                        xml: '<library>\n' + widgets.map(function (widget) {
                            return '<content id="' + widget.contentId + '"/>';
                        }).join('\n') + '\n' + (close ? '</library>\n' : ''),
                        built: widgets.length,
                        contentIds: widgets.map(function (widget) { return widget.contentId; }),
                        libraryId: 'site'
                    };
                },
                buildContentAssetXml: function (widget) {
                    return '<content id="' + widget.contentId + '"/>';
                },
                sanitizeContentId: function (widget) { return widget.contentId; },
                resolveLibraryId: function () { return 'site'; }
            },
            '*/cartridge/scripts/migration/contentMigration/contentMetaXmlBuilder': {
                buildMetaXml: function () { return '<metadata/>'; }
            },
            '*/cartridge/scripts/migration/core/migrationPaths': {
                getRelativePath: function () { return 'src/migration/content'; }
            },
            'dw/io/File': File,
            'dw/io/FileWriter': FileWriter,
            'dw/io/FileReader': FileReader
        });

        var first = runner.exportByContentIds(['one'], 'site', { finalize: false });
        var midXml = files['/impex/src/migration/content/content-test.xml'];
        expect(first.ok).to.equal(true);
        expect(first.finalized).to.equal(false);
        expect(midXml).to.contain('<content id="one"/>');
        expect(midXml).to.not.contain('</library>');

        var second = runner.exportByContentIds(['two'], 'site', {
            appendFile: first.fileName,
            finalize: true
        });
        var xml = files['/impex/src/migration/content/content-test.xml'];

        expect(second.ok).to.equal(true);
        expect(second.appended).to.equal(true);
        expect(second.finalized).to.equal(true);
        expect(xml).to.contain('<content id="one"/>');
        expect(xml).to.contain('<content id="two"/>');
        expect((xml.match(/<\/library>/g) || []).length).to.equal(1);
    });

    it('rejects oversized server batches', function () {
        var runner = proxyquire(runnerPath, {
            '*/cartridge/scripts/migration/core/migrationFileResolver': {},
            '*/cartridge/scripts/migration/contentMigration/amplienceContentFetcher': {},
            '*/cartridge/scripts/migration/contentMigration/amplienceContentTransformer': {},
            '*/cartridge/scripts/migration/contentMigration/contentXmlBuilder': {},
            '*/cartridge/scripts/migration/contentMigration/contentMetaXmlBuilder': {}
        });
        var ids = [];
        var i;
        for (i = 0; i < runner.MAX_BATCH + 1; i++) ids.push(String(i));

        var result = runner.exportByContentIds(ids);

        expect(result.ok).to.equal(false);
        expect(result.error).to.contain('batch limited');
        expect(runner.MAX_BATCH).to.equal(5);
    });
});
