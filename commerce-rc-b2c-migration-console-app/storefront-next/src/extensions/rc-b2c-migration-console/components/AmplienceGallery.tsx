import React, { useEffect, useState } from 'react';

type CatalogItem = {
    id?: string;
    name?: string;
    widgetType?: string;
    widgetLabel?: string;
    imageUrl?: string;
    deliveryKey?: string;
};

type CatalogPayload = {
    ok?: boolean;
    items?: CatalogItem[];
    total?: number;
    error?: string;
};

function catalogUrl(pageSize: number): string {
    var origin = '';
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
        origin = window.location.origin;
    }
    return origin + '/AmplienceContent-List?page=1&pageSize=' + String(pageSize);
}

/**
 * Storefront Next gallery for migrated Amplience content.
 * Reads AmplienceContent-List from app_custom_cms (SFRA controller on the storefront site).
 */
export function AmplienceGallery() {
    var [payload, setPayload] = useState<CatalogPayload | null>(null);
    var [loading, setLoading] = useState(true);
    var [error, setError] = useState('');

    useEffect(function () {
        var cancelled = false;
        setLoading(true);
        fetch(catalogUrl(24), { credentials: 'same-origin' })
            .then(function (res) {
                if (!res.ok) {
                    throw new Error('Catalog request failed (' + res.status + ')');
                }
                return res.json();
            })
            .then(function (data: CatalogPayload) {
                if (cancelled) return;
                if (!data || data.ok === false) {
                    throw new Error((data && data.error) || 'Catalog request failed');
                }
                setPayload(data);
                setError('');
            })
            .catch(function (err: Error) {
                if (!cancelled) {
                    setPayload(null);
                    setError(err && err.message ? err.message : 'Could not load AmplienceContent-List.');
                }
            })
            .finally(function () {
                if (!cancelled) setLoading(false);
            });
        return function () {
            cancelled = true;
        };
    }, []);

    var items = (payload && payload.items) || [];

    return (
        <section data-rc-amplience-gallery="true">
            <p>Royal Cyber CMS</p>
            <h2>Amplience component gallery</h2>
            {loading ? <p>Loading catalog…</p> : null}
            {error ? <p>{error}</p> : null}
            {!loading && !error && items.length === 0 ? (
                <p>
                    No Amplience components found. Confirm app_custom_cms is on the storefront
                    cartridge path and AmplienceContent-List is reachable.
                </p>
            ) : null}
            <ul>
                {items.map(function (item) {
                    var key = item.id || item.deliveryKey || item.name || Math.random().toString(36);
                    return (
                        <li key={key}>
                            {item.imageUrl ? (
                                <img src={item.imageUrl} alt={item.name || ''} />
                            ) : null}
                            <strong>{item.name || item.deliveryKey || item.id}</strong>
                            <span>{item.widgetLabel || item.widgetType || ''}</span>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

export default AmplienceGallery;
