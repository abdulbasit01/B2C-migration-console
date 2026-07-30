import React from 'react';
import { AmplienceRenderer } from '../components/AmplienceRenderer';
import { useAmplienceContent } from '../hooks/useAmplienceContent';

/**
 * Headless Page Designer wrapper for commerce_assets.amplienceWidget.
 * Expects PD attributes: hubName, deliveryKey, targetWidget, previewHtml.
 */
export function AmpliencePdWidget(props) {
    var hubName = props.hubName || props.data && props.data.hubName || '';
    var deliveryKey = props.deliveryKey || props.data && props.data.deliveryKey || '';
    var targetWidget = props.targetWidget || props.data && props.data.targetWidget || '';
    var previewHtml = props.previewHtml || props.data && props.data.previewHtml || '';

    var result = useAmplienceContent({
        hubName: hubName,
        deliveryKey: deliveryKey,
        targetWidget: targetWidget
    });

    if (result.loading) {
        return null;
    }

    if (result.error) {
        if (previewHtml) {
            return (
                <section className="amp-widget-fallback">
                    <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                </section>
            );
        }
        return (
            <section className="amp-detail__live-error" role="alert">
                {result.error.message || 'Failed to load Amplience content'}
            </section>
        );
    }

    return <AmplienceRenderer model={result.model} />;
}
