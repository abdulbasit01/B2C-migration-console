import React from 'react';

export function EditorialRichText({ bodyHtml, heading, name }) {
    var html = bodyHtml || heading;
    return (
        <section className="amp-rich-text">
            {html ? (
                <div dangerouslySetInnerHTML={{ __html: html }} />
            ) : name ? (
                <h2>{name}</h2>
            ) : null}
        </section>
    );
}
