import React from 'react';

export function CampaignBanner({ bodyHtml, heading, name }) {
    var html = bodyHtml || heading;
    return (
        <section className="amp-campaign-banner">
            {html ? (
                <div dangerouslySetInnerHTML={{ __html: html }} />
            ) : name ? (
                <h2>{name}</h2>
            ) : null}
        </section>
    );
}
