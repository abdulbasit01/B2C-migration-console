import React, { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { WIDGET_TYPE_FILTERS } from '@royalcyber/amplience-core';
import { useAmplienceCatalog } from '@royalcyber/amplience-react';
import GalleryCard from '../components/GalleryCard';
import './amplience-gallery.scss';

const SFCC_CONFIGURED = import.meta.env.VITE_SFCC_STOREFRONT_CONFIGURED === 'true';
const SFCC_STOREFRONT_URL = import.meta.env.VITE_SFCC_STOREFRONT_URL || '';
const API_BASE = SFCC_CONFIGURED
    ? (import.meta.env.DEV ? '/sfcc-api' : SFCC_STOREFRONT_URL)
    : '';
const DEFAULT_CATALOG_IDS = import.meta.env.VITE_AMPLIENCE_CATALOG_IDS
    || 'ba65f899-6545-4a21-8f09-00387d3a4b7d,4d2bf3b9-91ea-4d06-84a5-d3c826bbac0a';
const DEFAULT_HUB = import.meta.env.VITE_AMPLIENCE_HUB_NAME || 'royalcyber';
const PAGE_SIZE = 24;

function buildGallerySearch(type, query, page, publishedOnly) {
    var params = new URLSearchParams();
    if (type) params.set('type', type);
    if (query) params.set('q', query);
    if (publishedOnly) params.set('published', '1');
    if (page && page > 1) params.set('page', String(page));
    var search = params.toString();
    return search ? '?' + search : '';
}

export default function AmplienceGalleryPage() {
    var location = useLocation();
    var navigate = useNavigate();
    var params = useMemo(function () {
        return new URLSearchParams(location.search);
    }, [location.search]);

    var hubName = params.get('hub') || DEFAULT_HUB;
    var type = params.get('type') || '';
    var query = params.get('q') || '';
    var publishedOnly = params.get('published') === '1';
    var page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
    var catalog = useAmplienceCatalog({
        apiBase: API_BASE,
        hubName: hubName,
        catalogIds: DEFAULT_CATALOG_IDS,
        type: type,
        query: query,
        page: page,
        pageSize: PAGE_SIZE,
        publishedOnly: publishedOnly,
        enabled: !!hubName
    });

    function onSearchSubmit(event) {
        event.preventDefault();
        var formData = new FormData(event.currentTarget);
        var nextType = String(formData.get('type') || '');
        var nextQuery = String(formData.get('q') || '').trim();
        navigate('/amplience-gallery' + buildGallerySearch(nextType, nextQuery, 1, publishedOnly));
    }

    function onTypeChange(nextType) {
        navigate('/amplience-gallery' + buildGallerySearch(nextType, query, 1, publishedOnly));
    }

    function onPageChange(nextPage) {
        navigate('/amplience-gallery' + buildGallerySearch(type, query, nextPage, publishedOnly));
    }

    var items = (catalog.data && catalog.data.items) || [];
    var total = catalog.data ? catalog.data.total : 0;
    var pageCount = catalog.data ? catalog.data.pageCount : 1;

    return (
        <div className="amp-gallery-page">
            <header className="amp-gallery-page__intro">
                <p className="amp-gallery-page__eyebrow">Amplience storefront</p>
                <h1>Component gallery</h1>
                <p>Find migrated components by type or search. Click <strong>Preview</strong> on a card to load live Amplience content inline.</p>
            </header>

            <form className="amp-gallery-page__search" onSubmit={onSearchSubmit}>
                <input type="hidden" name="type" value={type} />
                <label className="amp-gallery-page__search-label" htmlFor="amp-gallery-q">
                    Search components
                </label>
                <div className="amp-gallery-page__search-row">
                    <input
                        id="amp-gallery-q"
                        className="amp-gallery-page__search-input"
                        type="search"
                        name="q"
                        defaultValue={query}
                        placeholder="Search by name, SFCC id, Amplience id, or delivery key"
                    />
                    <button className="amp-gallery-page__search-button" type="submit">Search</button>
                </div>
            </form>

            <nav className="amp-gallery-page__filters" aria-label="Filter components">
                {WIDGET_TYPE_FILTERS.map(function (filter) {
                    var active = type === filter.id;
                    return (
                        <button
                            key={filter.id || 'all'}
                            type="button"
                            className={'amp-gallery-page__filter' + (active ? ' active' : '')}
                            onClick={function () { onTypeChange(filter.id); }}
                        >
                            {filter.label}
                        </button>
                    );
                })}
                <button
                    type="button"
                    className={'amp-gallery-page__filter amp-gallery-page__filter--published'
                        + (publishedOnly ? ' active' : '')}
                    onClick={function () {
                        navigate('/amplience-gallery' + buildGallerySearch(type, query, 1, !publishedOnly));
                    }}
                >
                    Published on CDN
                </button>
            </nav>

            {!SFCC_CONFIGURED ? (
                <p className="amp-gallery-page__info">
                    SFCC storefront URL not configured. Add <code>VITE_SFCC_STOREFRONT_URL</code> to
                    <code>.env</code> or ensure <code>dw.json</code> has your sandbox hostname.
                    Run <code>npm run sync:sfcc-catalog</code> to refresh the local catalog file.
                </p>
            ) : null}

            <p className="amp-gallery-page__meta">
                Hub: <code>{hubName}</code>
                {catalog.source ? <span> · Source: {catalog.source}</span> : null}
            </p>

            {catalog.loading ? <p className="amp-gallery-page__status">Loading components…</p> : null}
            {catalog.error && !items.length ? (
                <p className="amp-gallery-page__error" role="alert">{catalog.error.message}</p>
            ) : null}

            {!catalog.loading && items.length ? (
                <p className="amp-gallery-page__meta">{total} component{total === 1 ? '' : 's'} found</p>
            ) : null}

            {!catalog.loading && !items.length && hubName && !catalog.error && publishedOnly ? (
                <p className="amp-gallery-page__info">
                    No CDN-published items in the local catalog. Content must be <strong>published in Amplience</strong>
                    (not just imported to SFCC), then run:
                    <code>npm run sync:sfcc-catalog -- --force --probe-cdn</code>
                </p>
            ) : null}

            {!catalog.loading && !items.length && hubName && !catalog.error && !publishedOnly ? (
                <p className="amp-gallery-page__status">No components match this filter.</p>
            ) : null}

            <div className="amp-gallery-page__grid">
                {items.map(function (item) {
                    return (
                        <GalleryCard key={item.id} item={item} hubName={hubName} />
                    );
                })}
            </div>

            {pageCount > 1 ? (
                <nav className="amp-gallery-page__pagination" aria-label="Gallery pages">
                    {page > 1 ? (
                        <button type="button" onClick={function () { onPageChange(page - 1); }}>Previous</button>
                    ) : null}
                    <span>Page {page} of {pageCount}</span>
                    {page < pageCount ? (
                        <button type="button" onClick={function () { onPageChange(page + 1); }}>Next</button>
                    ) : null}
                </nav>
            ) : null}
        </div>
    );
}
