import { useEffect, useState } from 'react';
import { fetchLiveContent } from '@royalcyber/amplience-core';

function fetchWithDraftPreview(hubName, deliveryKey, contentId, targetWidget) {
    return fetchLiveContent(hubName, deliveryKey || '', {
        contentId: contentId || '',
        targetWidget: targetWidget || ''
    }).catch(function (cdnErr) {
        if (!contentId || typeof window === 'undefined') {
            throw cdnErr;
        }

        var previewUrl = '/amplience-preview?contentId=' + encodeURIComponent(contentId);
        return fetch(previewUrl)
            .then(function (res) {
                if (!res.ok) {
                    throw cdnErr;
                }
                return res.json();
            })
            .then(function (payload) {
                if (!payload || !payload.ok || !payload.model) {
                    throw cdnErr;
                }
                return payload.model;
            })
            .catch(function () {
                throw cdnErr;
            });
    });
}

/**
 * Fetch live Amplience content and return a renderer model.
 * Falls back to Management API draft preview in Vite dev when CDN returns 404.
 * @param {Object} params
 * @param {string} params.hubName
 * @param {string} [params.deliveryKey]
 * @param {string} [params.contentId]
 * @param {string} [params.targetWidget]
 * @param {boolean} [params.enabled=true]
 */
export function useAmplienceContent({
    hubName,
    deliveryKey,
    contentId,
    targetWidget,
    enabled
}) {
    var [model, setModel] = useState(null);
    var [loading, setLoading] = useState(false);
    var [error, setError] = useState(null);
    var isEnabled = enabled !== false;

    useEffect(function () {
        if (!isEnabled || !hubName || (!deliveryKey && !contentId)) {
            setModel(null);
            setError(null);
            setLoading(false);
            return undefined;
        }

        var cancelled = false;
        setLoading(true);
        setError(null);

        fetchWithDraftPreview(hubName, deliveryKey, contentId, targetWidget)
            .then(function (nextModel) {
                if (!cancelled) {
                    setModel(nextModel);
                    setLoading(false);
                }
            })
            .catch(function (err) {
                if (!cancelled) {
                    setError(err);
                    setModel(null);
                    setLoading(false);
                }
            });

        return function () {
            cancelled = true;
        };
    }, [hubName, deliveryKey, contentId, targetWidget, isEnabled]);

    return { model: model, loading: loading, error: error };
}
