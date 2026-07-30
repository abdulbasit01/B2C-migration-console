import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AmplienceRenderer, useAmplienceContent } from '@royalcyber/amplience-react';
import './amplience-demo.scss';

const DEFAULT_HERO_ID = import.meta.env.VITE_AMPLIENCE_DEFAULT_CONTENT_ID
    || 'ba65f899-6545-4a21-8f09-00387d3a4b7d';
const DEFAULT_RICH_TEXT_ID = import.meta.env.VITE_AMPLIENCE_DEFAULT_RICH_TEXT_ID
    || '4d2bf3b9-91ea-4d06-84a5-d3c826bbac0a';

function parseDemoItems(params) {
    var keys = (params.get('keys') || '')
        .split(',')
        .map(function (key) { return key.trim(); })
        .filter(Boolean)
        .map(function (key) {
            return { type: 'key', value: key, label: key };
        });

    var ids = (params.get('ids') || '')
        .split(',')
        .map(function (id) { return id.trim(); })
        .filter(Boolean)
        .map(function (id) {
            return { type: 'id', value: id, label: id };
        });

    if (keys.length || ids.length) {
        return keys.concat(ids);
    }

    var defaults = [{
        type: 'id',
        value: DEFAULT_HERO_ID,
        label: 'Hero banner'
    }];

    if (DEFAULT_RICH_TEXT_ID) {
        defaults.push({
            type: 'id',
            value: DEFAULT_RICH_TEXT_ID,
            label: 'Rich text'
        });
    }

    return defaults;
}

function shortenId(value) {
    var text = String(value || '');
    if (text.length <= 28) return text;
    return text.slice(0, 14) + '…' + text.slice(-10);
}

function copyText(value) {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(String(value)).catch(function () {});
}

function DemoSlot({ hubName, item, compact }) {
    var deliveryKey = item.type === 'key' ? item.value : '';
    var contentId = item.type === 'id' ? item.value : '';

    var result = useAmplienceContent({
        hubName: hubName,
        deliveryKey: deliveryKey,
        contentId: contentId,
        enabled: !!(hubName && (deliveryKey || contentId))
    });

    var title = result.model && result.model.name ? result.model.name : item.label;
    var widgetType = result.model && result.model.widgetType ? result.model.widgetType : '';
    var widgetLabel = result.model && result.model.widgetLabel ? result.model.widgetLabel : widgetType;
    var isDraft = result.model && result.model.liveSource === 'management';
    var idLabel = item.type === 'key' ? 'Delivery key' : 'Amplience id';
    var idValue = item.value;

    return (
        <section className={'amp-demo-slot' + (widgetType ? ' amp-demo-slot--' + widgetType : '')}>
            <header className="amp-demo-slot__header">
                <div className="amp-demo-slot__heading">
                    <h2>{title}</h2>
                    <div className="amp-demo-slot__meta">
                        {widgetLabel ? (
                            <span className="amp-demo-slot__type">{widgetLabel}</span>
                        ) : null}
                        {isDraft ? (
                            <span className="amp-demo-slot__badge amp-demo-slot__badge--draft">Draft preview</span>
                        ) : result.model ? (
                            <span className="amp-demo-slot__badge amp-demo-slot__badge--live">CDN</span>
                        ) : null}
                    </div>
                </div>
                <button
                    type="button"
                    className="amp-demo-slot__id"
                    title={idValue + ' (click to copy)'}
                    onClick={function () { copyText(idValue); }}
                >
                    <span className="amp-demo-slot__id-label">{idLabel}</span>
                    <code>{shortenId(idValue)}</code>
                </button>
            </header>
            {result.loading ? <p className="amp-demo-slot__status">Loading…</p> : null}
            {isDraft && !compact ? (
                <p className="amp-demo-slot__draft" role="status">
                    Unpublished draft — publish in Amplience to serve from the live CDN.
                </p>
            ) : null}
            {result.error ? (
                <div className="amp-demo-slot__error" role="alert">
                    <p>{result.error.message}</p>
                    {item.type === 'key' ? (
                        <p className="amp-demo-slot__hint">
                            Use <code>?ids=YOUR-CONTENT-ID</code> from BM wizard Step 2 instead of a delivery key.
                        </p>
                    ) : null}
                </div>
            ) : null}
            {result.model ? (
                <div className="amp-demo-slot__content">
                    <AmplienceRenderer model={result.model} />
                </div>
            ) : null}
        </section>
    );
}

export default function AmplienceDemoPage() {
    var location = useLocation();
    var params = useMemo(function () {
        return new URLSearchParams(location.search);
    }, [location.search]);

    var hubName = params.get('hub') || import.meta.env.VITE_AMPLIENCE_HUB_NAME || '';
    var items = useMemo(function () {
        return parseDemoItems(params);
    }, [params]);

    var pageExample = DEFAULT_HERO_ID + ',' + DEFAULT_RICH_TEXT_ID;
    var hasExplicitIds = !!(params.get('ids') || params.get('keys'));
    var compact = hasExplicitIds && items.length === 1;

    return (
        <div className={'amp-demo-page' + (compact ? ' amp-demo-page--compact' : '')}>
            <header className="amp-demo-page__intro">
                {compact ? (
                    <>
                        <Link className="amp-demo-page__back" to="/amplience-gallery">← Back to gallery</Link>
                        <p className="amp-demo-page__meta">
                            Hub: <code>{hubName}</code>
                        </p>
                    </>
                ) : (
                    <>
                        <p className="amp-demo-page__eyebrow">Amplience live CDN</p>
                        <h1>Amplience demo</h1>
                        <p>
                            Stack a full page (banner + rich text) by passing multiple content ids in order:
                        </p>
                        <ul className="amp-demo-page__examples">
                            <li>
                                Banner + rich text:
                                <code>?ids={pageExample}</code>
                            </li>
                            <li>Single hero: <code>?ids={DEFAULT_HERO_ID}</code></li>
                            <li>Rich text only: <code>?ids={DEFAULT_RICH_TEXT_ID}</code></li>
                        </ul>

                        <p className="amp-demo-page__info">
                            Browse and filter components in the <Link to="/amplience-gallery">component gallery</Link>,
                            then click Preview. Copy Amplience ids from BM Content Migration Step 2.
                        </p>
                        {!hubName ? (
                            <p className="amp-demo-page__error" role="alert">
                                Set <code>AMPLIENCE_HUB_NAME</code> in the repo root <code>.env</code>
                                or add <code>?hub=your-hub</code> to the URL.
                            </p>
                        ) : (
                            <p className="amp-demo-page__meta">
                                Hub: <code>{hubName}</code>
                                {hasExplicitIds ? (
                                    <span> · Showing {items.length} requested component{items.length === 1 ? '' : 's'}</span>
                                ) : null}
                            </p>
                        )}
                    </>
                )}
            </header>

            {items.map(function (item) {
                return (
                    <DemoSlot
                        key={item.type + ':' + item.value}
                        hubName={hubName}
                        item={item}
                        compact={compact}
                    />
                );
            })}
        </div>
    );
}
