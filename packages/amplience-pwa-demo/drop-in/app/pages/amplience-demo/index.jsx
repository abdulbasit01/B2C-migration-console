import React, {useMemo} from 'react';
import {useLocation} from 'react-router-dom';
import {
    AmplienceRenderer,
    useAmplienceContent
} from '@royalcyber/amplience-react';

function DemoSlot({hubName, deliveryKey, label}) {
    const {model, loading, error} = useAmplienceContent({
        hubName: hubName,
        deliveryKey: deliveryKey,
        enabled: !!(hubName && deliveryKey)
    });

    return (
        <section className="amp-demo-slot">
            <header className="amp-demo-slot__header">
                <h2>{label || deliveryKey}</h2>
                <code>{deliveryKey}</code>
            </header>
            {loading ? <p className="amp-demo-slot__status">Loading…</p> : null}
            {error ? (
                <p className="amp-demo-slot__error" role="alert">
                    {error.message}
                </p>
            ) : null}
            {model ? <AmplienceRenderer model={model} /> : null}
        </section>
    );
}

/**
 * Drop-in demo page for Retail React App.
 * Route: /amplience-demo?hub=YOUR_HUB&keys=hero,header/promo
 *
 * Copy this file into your PWA Kit app at app/pages/amplience-demo/index.jsx
 * and register the route (see packages/amplience-pwa-demo/README.md).
 */
export default function AmplienceDemoPage() {
    const location = useLocation();
    const params = useMemo(function () {
        return new URLSearchParams(location.search);
    }, [location.search]);

    const hubName = params.get('hub')
        || (typeof process !== 'undefined' && process.env.AMPLIENCE_HUB_NAME)
        || '';
    const keysParam = params.get('keys') || 'hero';
    const deliveryKeys = keysParam.split(',').map(function (key) {
        return key.trim();
    }).filter(Boolean);

    return (
        <div className="amp-demo-page container">
            <header className="amp-demo-page__intro">
                <p className="amp-demo-page__eyebrow">Amplience live CDN</p>
                <h1>Amplience demo</h1>
                <p>
                    Renders published Amplience content directly from CDN.
                    Pass <code>?hub=your-hub&amp;keys=hero,header/promo</code> to try other keys.
                </p>
                {!hubName ? (
                    <p className="amp-demo-page__error" role="alert">
                        Set AMPLIENCE_HUB_NAME in .env or add <code>?hub=your-hub</code> to the URL.
                    </p>
                ) : null}
            </header>

            {deliveryKeys.map(function (deliveryKey) {
                return (
                    <DemoSlot
                        key={deliveryKey}
                        hubName={hubName}
                        deliveryKey={deliveryKey}
                        label={deliveryKey}
                    />
                );
            })}
        </div>
    );
}
