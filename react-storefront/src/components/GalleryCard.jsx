import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AmplienceRenderer, useAmplienceContent } from '@royalcyber/amplience-react';

function shortenId(value) {
    var text = String(value || '');
    if (text.length <= 24) return text;
    return text.slice(0, 12) + '…' + text.slice(-10);
}

function parseSchemaLabel(description) {
    var match = String(description || '').match(/Schema:\s*([^|]+)/i);
    return match ? match[1].trim().replace(/-/g, ' ') : '';
}

function isCatalogImage(url) {
    var value = String(url || '').trim();
    if (!/^https?:\/\//i.test(value)) return false;
    if (/cdn\.media\.amplience\.net/i.test(value)) return true;
    if (/\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/i.test(value)) return true;
    return false;
}

function copyText(value) {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(String(value)).catch(function () {});
}

export default function GalleryCard({ item, hubName }) {
    var [expanded, setExpanded] = useState(false);
    var contentId = item.contentId || String(item.id || '').replace(/^amp-/, '');
    var demoUrl = '/amplience-demo?ids=' + encodeURIComponent(contentId);
    var schemaLabel = parseSchemaLabel(item.description);
    var thumbUrl = isCatalogImage(item.imageUrl) ? item.imageUrl : '';
    var isBannerCard = item.widgetType === 'mainBanner' || item.widgetType === 'campaignBanner';

    var live = useAmplienceContent({
        hubName: hubName,
        contentId: contentId,
        deliveryKey: item.deliveryKey || '',
        enabled: expanded && !!hubName && !!contentId
    });

    return (
        <article className={'amp-gallery-page__card amp-gallery-page__card--' + (item.widgetType || 'widget')
            + (isBannerCard ? ' amp-gallery-page__card--banner' : '')}>
            {thumbUrl ? (
                <div className={'amp-gallery-page__card-hero' + (isBannerCard ? ' amp-gallery-page__card-hero--banner' : '')}>
                    <img src={thumbUrl} alt="" loading="lazy" />
                </div>
            ) : null}

            <div className="amp-gallery-page__card-body">
                <div className="amp-gallery-page__card-accent" aria-hidden="true" />
                <div className="amp-gallery-page__card-meta">
                    <div className="amp-gallery-page__card-heading">
                        <h2>{item.name}</h2>
                        <div className="amp-gallery-page__card-tags">
                            <span className="amp-gallery-page__card-type">{item.widgetLabel || item.widgetType}</span>
                            {schemaLabel ? (
                                <span className="amp-gallery-page__card-schema">{schemaLabel}</span>
                            ) : null}
                            {item.publishedOnCdn === true ? (
                                <span className="amp-gallery-page__badge amp-gallery-page__badge--live">CDN</span>
                            ) : null}
                            {item.publishedOnCdn === false ? (
                                <span className="amp-gallery-page__badge amp-gallery-page__badge--draft">Draft</span>
                            ) : null}
                        </div>
                    </div>
                    <div className="amp-gallery-page__card-actions">
                        <button
                            type="button"
                            className={'amp-gallery-page__preview-toggle' + (expanded ? ' is-active' : '')}
                            onClick={function () { setExpanded(!expanded); }}
                        >
                            {expanded ? 'Hide' : 'Preview'}
                        </button>
                        <Link className="amp-gallery-page__preview-link" to={demoUrl}>Open</Link>
                    </div>
                </div>

                <div className="amp-gallery-page__card-ids">
                    {item.contentId ? (
                        <div className="amp-gallery-page__card-id-row">
                            <span className="amp-gallery-page__card-id-label">Amplience id</span>
                            <button
                                type="button"
                                className="amp-gallery-page__id-pill"
                                title={item.contentId + ' (click to copy)'}
                                onClick={function () { copyText(item.contentId); }}
                            >
                                <code>{shortenId(item.contentId)}</code>
                            </button>
                        </div>
                    ) : null}
                    <div className="amp-gallery-page__card-id-row">
                        <span className="amp-gallery-page__card-id-label">SFCC id</span>
                        <button
                            type="button"
                            className="amp-gallery-page__id-pill"
                            title={item.id + ' (click to copy)'}
                            onClick={function () { copyText(item.id); }}
                        >
                            <code>{shortenId(item.id)}</code>
                        </button>
                    </div>
                    {item.deliveryKey ? (
                        <div className="amp-gallery-page__card-id-row">
                            <span className="amp-gallery-page__card-id-label">Delivery key</span>
                            <button
                                type="button"
                                className="amp-gallery-page__id-pill"
                                title={item.deliveryKey + ' (click to copy)'}
                                onClick={function () { copyText(item.deliveryKey); }}
                            >
                                <code>{item.deliveryKey}</code>
                            </button>
                        </div>
                    ) : null}
                </div>
            </div>

            {expanded ? (
                <div className="amp-gallery-page__card-preview">
                    {live.loading ? <p className="amp-gallery-page__card-preview-status">Loading live content…</p> : null}
                    {live.error ? (
                        <p className="amp-gallery-page__card-preview-error" role="alert">
                            {live.error.message}
                        </p>
                    ) : null}
                    {live.model ? (
                        <div className="amp-gallery-page__card-preview-body">
                            <AmplienceRenderer model={live.model} />
                        </div>
                    ) : null}
                </div>
            ) : null}
        </article>
    );
}
