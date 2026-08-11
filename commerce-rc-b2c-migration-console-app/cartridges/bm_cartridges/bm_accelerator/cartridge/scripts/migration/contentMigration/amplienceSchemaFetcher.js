'use strict';

var http     = require('*/cartridge/scripts/migration/core/amplienceApi');
var auth     = require('*/cartridge/scripts/migration/connectors/amplience/amplienceAuth');
var hubHelper = require('*/cartridge/scripts/migration/contentMigration/amplienceHubHelper');
var mapper   = require('*/cartridge/scripts/migration/contentMigration/amplienceSchemaMapper');

function summarizeContentType(ct) {
    var schemaUri = ct.schemaUri || ct.uri || ct.contentTypeUri || '';
    var mapping   = mapper.mapContentType(ct);
    return {
        id:                ct.id || '',
        label:             ct.label || ct.name || schemaUri.split('/').pop() || 'Untitled',
        schemaUri:         schemaUri,
        schemaShort:       schemaUri ? schemaUri.split('/').pop() : '',
        status:            ct.status || '',
        sfccComponent:     mapping.component,
        sfccComponentLabel: mapping.componentLabel,
        fieldCount:        mapping.fieldCount
    };
}

/**
 * List Amplience content types for the configured hub.
 * @param {number} [pageSize]
 * @returns {Object}
 */
function listContentTypes(pageSize) {
    if (!auth.hasManagementCreds(auth.resolveCreds())) {
        throw new Error('Personal Access Token required. Complete Connect step first.');
    }

    var limit = Math.min(Math.max(parseInt(String(pageSize || 100), 10) || 100, 1), 100);
    var ctx   = hubHelper.getHubContext();
    var res   = http.get(
        hubHelper.API_BASE + '/hubs/' + encodeURIComponent(ctx.hub.id)
            + '/content-types?page=0&size=' + limit + '&sort=label,asc',
        hubHelper.authHeaders(ctx.token)
    );

    if (res.status !== 200) {
        throw new Error('Unable to list content types (' + res.status + ')');
    }

    var raw   = (res.data._embedded && res.data._embedded['content-types']) || [];
    var types = [];
    var i;
    for (i = 0; i < raw.length; i++) {
        types.push(summarizeContentType(raw[i]));
    }

    return {
        total:   res.data.page ? (res.data.page.totalElements || types.length) : types.length,
        types:   types,
        hubName: ctx.hub.name
    };
}

module.exports = {
    listContentTypes: listContentTypes
};
