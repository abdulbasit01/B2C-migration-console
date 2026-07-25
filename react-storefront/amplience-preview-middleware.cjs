'use strict';



var path = require('path');



var PREVIEW_CACHE_MS = 5 * 60 * 1000;

var previewCache = new Map();



function getCachedPreview(contentId) {

    var entry = previewCache.get(contentId);

    if (!entry) return null;

    if (Date.now() - entry.at > PREVIEW_CACHE_MS) {

        previewCache.delete(contentId);

        return null;

    }

    return entry.payload;

}



function putCachedPreview(contentId, payload) {

    previewCache.set(contentId, { at: Date.now(), payload: payload });

}



/**

 * Vite dev middleware: preview unpublished Amplience content via Management API.

 * PAT stays server-side in repo root .env — never sent to the browser.

 */

function createAmpliencePreviewMiddleware(env) {

    var corePath = path.resolve(__dirname, '../packages/amplience-core/src/index.js');

    var core = require(corePath);

    var token = env.AMPLIENCE_PERSONAL_ACCESS_TOKEN || '';

    var hubName = env.AMPLIENCE_HUB_NAME || env.VITE_AMPLIENCE_HUB_NAME || 'royalcyber';



    return function ampliencePreviewMiddleware(req, res, next) {

        if (!req.url || req.url.indexOf('/amplience-preview') !== 0) {

            return next();

        }



        var requestUrl = new URL(req.url, 'http://localhost');

        var contentId = String(requestUrl.searchParams.get('contentId') || '').trim();

        var bypassCache = requestUrl.searchParams.get('nocache') === '1';



        if (!contentId) {

            res.statusCode = 400;

            res.setHeader('Content-Type', 'application/json');

            res.end(JSON.stringify({ ok: false, error: 'contentId is required' }));

            return;

        }

        if (!token) {

            res.statusCode = 503;

            res.setHeader('Content-Type', 'application/json');

            res.end(JSON.stringify({

                ok: false,

                error: 'AMPLIENCE_PERSONAL_ACCESS_TOKEN is required in repo root .env for draft previews'

            }));

            return;

        }



        if (!bypassCache) {

            var cached = getCachedPreview(contentId);

            if (cached) {

                res.statusCode = 200;

                res.setHeader('Content-Type', 'application/json');

                res.end(JSON.stringify(cached));

                return;

            }

        }



        fetch('https://api.amplience.net/v2/content/content-items/' + encodeURIComponent(contentId), {

            headers: {

                Authorization: 'Bearer ' + token,

                'Content-Type': 'application/json'

            }

        })

            .then(function (mgmtRes) {

                if (!mgmtRes.ok) {

                    res.statusCode = mgmtRes.status;

                    res.setHeader('Content-Type', 'application/json');

                    return mgmtRes.text().then(function (body) {

                        res.end(JSON.stringify({

                            ok: false,

                            error: 'Amplience Management API (' + mgmtRes.status + '): ' + body

                        }));

                    });

                }

                return mgmtRes.json().then(function (item) {

                    var body = item.body || item;

                    var content = core.unwrapCdnPayload({ content: body });

                    if (!content || typeof content !== 'object' || !Object.keys(content).length) {

                        content = body;

                    }

                    var model = core.toRendererModel(content, {

                        hubName: hubName,

                        contentId: contentId,

                        deliveryKey: (body._meta && body._meta.deliveryKey) || item.deliveryKey || ''

                    });

                    model.liveSource = 'management';

                    model.publishedOnCdn = false;

                    model.previewNote = 'Draft preview from Amplience Management API. Publish to see live CDN content.';

                    var payload = { ok: true, model: model };

                    putCachedPreview(contentId, payload);

                    res.statusCode = 200;

                    res.setHeader('Content-Type', 'application/json');

                    res.end(JSON.stringify(payload));

                });

            })

            .catch(function (err) {

                res.statusCode = 500;

                res.setHeader('Content-Type', 'application/json');

                res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));

            });

    };

}



module.exports = {

    createAmpliencePreviewMiddleware: createAmpliencePreviewMiddleware

};

