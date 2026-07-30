import { useEffect, useState } from 'react';
import { fetchLiveContent } from '@royalcyber/amplience-core';

function buildCatalogUrl(apiBase, params) {
    var base = String(apiBase || '').replace(/\/$/, '');
    var path = base + '/AmplienceContent-List';
    var url = path.indexOf('http') === 0
        ? new URL(path)
        : new URL(path, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001');
    if (params.type) url.searchParams.set('type', params.type);
    if (params.query) url.searchParams.set('q', params.query);
    if (params.page) url.searchParams.set('page', String(params.page));
    if (params.pageSize) url.searchParams.set('pageSize', String(params.pageSize));
    return url.toString();
}

function matchesClientQuery(item, query) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    var haystack = [
        item.name,
        item.id,
        item.contentId,
        item.deliveryKey,
        item.widgetType,
        item.widgetLabel,
        item.schema
    ].map(function (value) {
        return String(value || '').toLowerCase();
    }).join(' ');
    return haystack.indexOf(q) >= 0;
}

function filterCatalogItems(items, type, query, publishedOnly) {
    return items.filter(function (item) {
        if (type && item.widgetType !== type) return false;
        if (publishedOnly && item.publishedOnCdn !== true) return false;
        return matchesClientQuery(item, query);
    });
}

function paginateItems(items, page, pageSize) {
    var total = items.length;
    var pageCount = Math.max(1, Math.ceil(total / pageSize));
    var safePage = Math.min(Math.max(page, 1), pageCount);
    var start = (safePage - 1) * pageSize;
    return {
        items: items.slice(start, start + pageSize),
        total: total,
        page: safePage,
        pageSize: pageSize,
        pageCount: pageCount,
        hasPrevious: safePage > 1,
        hasNext: safePage < pageCount
    };
}

function parseCatalogIds(raw) {
    return String(raw || '')
        .split(',')
        .map(function (id) { return id.trim(); })
        .filter(Boolean);
}

function fetchCatalogFromCdn(hubName, contentIds) {
    var requests = contentIds.map(function (contentId) {
        return fetchLiveContent(hubName, '', { contentId: contentId })
            .then(function (model) {
                return {
                    id: 'amp-' + contentId,
                    name: model.name || contentId,
                    description: '',
                    widgetType: model.widgetType,
                    widgetLabel: model.widgetLabel || model.widgetType,
                    contentId: contentId,
                    deliveryKey: model.deliveryKey || '',
                    imageUrl: model.imageUrl || ''
                };
            })
            .catch(function () {
                return null;
            });
    });

    return Promise.all(requests).then(function (results) {
        return results.filter(Boolean);
    });
}

function buildClientCatalogPayload(items, type, query, page, pageSize, source, publishedOnly) {
    var filtered = filterCatalogItems(items, type, query, publishedOnly);
    var paged = paginateItems(filtered, page, pageSize);
    return {
        ok: true,
        total: paged.total,
        page: paged.page,
        pageSize: paged.pageSize,
        pageCount: paged.pageCount,
        hasPrevious: paged.hasPrevious,
        hasNext: paged.hasNext,
        type: type,
        query: query,
        folderFound: true,
        source: source,
        items: paged.items
    };
}

function fetchLocalCatalog() {
    return fetch('/amplience-catalog.json')
        .then(function (response) {
            if (!response.ok) {
                throw new Error('Local catalog not found');
            }
            return response.json();
        })
        .then(function (payload) {
            if (!payload || !Array.isArray(payload.items)) {
                throw new Error('Invalid local catalog file');
            }
            return payload.items;
        });
}

function shouldPreferLocalCatalog() {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
        if (import.meta.env.VITE_USE_LIVE_SFCC_CATALOG === 'true') return false;
    }
    return true;
}

/**
 * Load migrated Amplience components from SFCC, local catalog JSON, or CDN fallback.
 */
export function useAmplienceCatalog({
    apiBase,
    hubName,
    catalogIds,
    type = '',
    query = '',
    page = 1,
    pageSize = 24,
    publishedOnly = false,
    enabled = true
}) {
    var [data, setData] = useState(null);
    var [loading, setLoading] = useState(false);
    var [error, setError] = useState(null);
    var [source, setSource] = useState('');

    useEffect(function () {
        if (!enabled) {
            setData(null);
            setLoading(false);
            setError(null);
            setSource('');
            return undefined;
        }

        var cancelled = false;
        setLoading(true);
        setError(null);

        function applyClientCatalog(items, sourceName) {
            var payload = buildClientCatalogPayload(
                items, type, query, page, pageSize, sourceName, publishedOnly
            );
            setData(payload);
            setSource(sourceName);
            setError(null);
        }

        function finishWithLocalCatalog(fallbackError) {
            return fetchLocalCatalog()
                .then(function (items) {
                    if (cancelled) return;
                    applyClientCatalog(items, items.length ? 'sfcc-file' : 'catalog');
                })
                .catch(function () {
                    return finishWithCdn(fallbackError);
                });
        }

        function finishWithCdn(fallbackError) {
            var ids = parseCatalogIds(catalogIds);
            if (!hubName || !ids.length) {
                if (!cancelled) {
                    setData(null);
                    setSource('');
                    setError(fallbackError || new Error(
                        'Catalog unavailable. Run npm run export:amplience-catalog or set VITE_SFCC_STOREFRONT_URL.'
                    ));
                }
                return Promise.resolve();
            }

            return fetchCatalogFromCdn(hubName, ids)
                .then(function (items) {
                    if (cancelled) return;
                    applyClientCatalog(items, 'cdn');
                })
                .catch(function (err) {
                    if (!cancelled) {
                        setData(null);
                        setSource('');
                        setError(err);
                    }
                });
        }

        var request;

        try {
            if (shouldPreferLocalCatalog()) {
                request = finishWithLocalCatalog();
            } else if (apiBase) {
                request = fetch(buildCatalogUrl(apiBase, {
                    type: type,
                    query: query,
                    page: page,
                    pageSize: pageSize
                }))
                    .then(function (response) {
                        if (!response.ok) {
                            throw new Error('Catalog request failed (' + response.status + ')');
                        }
                        return response.json();
                    })
                    .then(function (payload) {
                        if (cancelled) return;
                        if (!payload || !payload.ok) {
                            throw new Error((payload && payload.error) || 'Catalog request failed');
                        }
                        payload.source = 'sfcc';
                        setData(payload);
                        setSource('sfcc');
                        setError(null);
                    });
            } else {
                request = finishWithLocalCatalog();
            }

            request
                .catch(function (err) {
                    if (cancelled) return;
                    return finishWithLocalCatalog(err);
                })
                .finally(function () {
                    if (!cancelled) setLoading(false);
                });
        } catch (err) {
            if (!cancelled) {
                finishWithLocalCatalog(err).finally(function () {
                    if (!cancelled) setLoading(false);
                });
            }
        }

        return function () {
            cancelled = true;
        };
    }, [apiBase, hubName, catalogIds, type, query, page, pageSize, publishedOnly, enabled]);

    return { data: data, loading: loading, error: error, source: source };
}
