'use strict';

var URLUtils         = require('dw/web/URLUtils');
var CSRFProtection   = require('dw/web/CSRFProtection');

/**
 * Append a fresh CSRF token to a BM URL.
 * @param {dw.web.URL} url
 * @returns {dw.web.URL}
 */
function withCsrf(url) {
    url.append('csrf_token', CSRFProtection.generateToken());
    return url;
}

/**
 * Business Manager IMPEX folder browser for a path under Sites/Impex.
 * @param {string} impexRelativePath - e.g. src/migration/{runId}/src/orders
 * @returns {string}
 */
function getImpexFolderUrl(impexRelativePath) {
    var normalized = String(impexRelativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    var target = 'Sites/Impex' + (normalized ? '/' + normalized : '');
    var url = withCsrf(URLUtils.https('ViewStudioSetup-OpenFolder'));
    url.append('TargetFolder', target);
    return url.toString();
}

/**
 * Business Manager "Import & Export" screen (Administration > Site Development > Import & Export).
 * @returns {string}
 */
function getImportExportUrl() {
    var url = withCsrf(URLUtils.https('ViewCustomizationImpex-Start'));
    url.append('SelectedMenuItem', 'customization_impex');
    url.append('CurrentMenuItemId', 'studio');
    return url.toString();
}

module.exports = {
    getImpexFolderUrl:  getImpexFolderUrl,
    getImportExportUrl: getImportExportUrl
};
