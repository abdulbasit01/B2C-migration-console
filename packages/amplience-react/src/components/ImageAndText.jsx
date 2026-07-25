import React from 'react';

export function ImageAndText({ imageUrl, heading, bodyHtml, name }) {
    return (
        <section className="amp-image-text">
            {imageUrl ? (
                <div className="amp-image-text__media">
                    <img src={imageUrl} alt={name || ''} loading="lazy" />
                </div>
            ) : null}
            <div className="amp-image-text__copy">
                {heading ? <div dangerouslySetInnerHTML={{ __html: heading }} /> : null}
                {bodyHtml ? <div dangerouslySetInnerHTML={{ __html: bodyHtml }} /> : null}
            </div>
        </section>
    );
}
