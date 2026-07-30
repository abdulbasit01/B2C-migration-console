import React, { useMemo, useState } from 'react';
import { groupLocalizedPreviewFields } from '@royalcyber/amplience-core';

function LocalizedField({ field }) {
    var options = field.options || [];
    var defaultIndex = 0;
    var i;

    for (i = 0; i < options.length; i++) {
        if (String(options[i].locale || '').toLowerCase().indexOf('en') === 0) {
            defaultIndex = i;
            break;
        }
    }

    var [activeIndex, setActiveIndex] = useState(defaultIndex);
    var active = options[activeIndex] || options[0];

    if (!active) return null;

    return (
        <div className="amp-widget-fallback__field amp-widget-fallback__field--localized">
            <div className="amp-locale-toolbar">
                <span className="amp-locale-toolbar__label">{field.name}</span>
                <select
                    className="amp-locale-select"
                    aria-label={field.name + ' locale'}
                    value={String(activeIndex)}
                    onChange={function (event) {
                        setActiveIndex(parseInt(event.target.value, 10) || 0);
                    }}
                >
                    {options.map(function (opt, index) {
                        return (
                            <option key={opt.locale || index} value={String(index)}>
                                {opt.label || opt.locale}
                            </option>
                        );
                    })}
                </select>
            </div>
            {active.type === 'image' ? (
                <div className="amp-widget-fallback__image">
                    <img src={active.value} alt={active.label || field.name} loading="lazy" />
                </div>
            ) : (
                <p>{String(active.value)}</p>
            )}
        </div>
    );
}

export function AmplienceWidget({ fields, images, bodyHtml, heading, name, preview }) {
    var fieldList = useMemo(function () {
        var raw = fields || (preview && preview.fields) || [];
        return groupLocalizedPreviewFields(raw);
    }, [fields, preview]);
    var imageList = images || (preview && preview.images) || [];

    return (
        <section className="amp-widget-fallback">
            {heading ? <div dangerouslySetInnerHTML={{ __html: heading }} /> : null}
            {bodyHtml ? <div dangerouslySetInnerHTML={{ __html: bodyHtml }} /> : null}
            {!heading && !bodyHtml && name ? <h2>{name}</h2> : null}
            {fieldList.map(function (field) {
                if (!field) return null;
                if (field.type === 'localized' && field.options && field.options.length) {
                    return <LocalizedField key={field.name} field={field} />;
                }
                if (field.value == null || field.value === '') return null;
                return (
                    <div className="amp-widget-fallback__field" key={field.name}>
                        <span>{field.name}</span>
                        {field.type === 'image' ? (
                            <div className="amp-widget-fallback__image">
                                <img src={field.value} alt={field.name} loading="lazy" />
                            </div>
                        ) : (
                            <p>{String(field.value)}</p>
                        )}
                    </div>
                );
            })}
            {imageList.map(function (image) {
                if (!image || !image.url) return null;
                return (
                    <div className="amp-widget-fallback__image" key={image.name || image.url}>
                        <img src={image.url} alt={image.name || ''} loading="lazy" />
                    </div>
                );
            })}
        </section>
    );
}
