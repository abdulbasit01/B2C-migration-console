import React from 'react';

function alignClass(textAlign) {
    var value = String(textAlign || 'center').toLowerCase();
    if (value === 'left' || value === 'right' || value === 'center') {
        return 'amp-main-banner--align-' + value;
    }
    return 'amp-main-banner--align-center';
}

export function MainBanner({ imageUrl, heading, bodyHtml, name, textAlign }) {
    return (
        <section className={'amp-main-banner ' + alignClass(textAlign)}>
            {imageUrl ? <img src={imageUrl} alt={name || ''} loading="lazy" /> : null}
            <div className="amp-main-banner__overlay">
                {heading ? (
                    <div dangerouslySetInnerHTML={{ __html: heading }} />
                ) : bodyHtml ? (
                    <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                ) : name ? (
                    <h2>{name}</h2>
                ) : null}
            </div>
        </section>
    );
}
