import React from 'react';
import { Link } from 'react-router-dom';

const hubName = import.meta.env.VITE_AMPLIENCE_HUB_NAME || '';

export default function HomePage() {
    const demoUrl = hubName
        ? `/amplience-demo?hub=${encodeURIComponent(hubName)}`
        : '/amplience-demo';

    return (
        <section className="home-page">
            <p className="home-page__eyebrow">React storefront</p>
            <h1>Synced with B2C Migration Console</h1>
            <p>
                This app uses the shared Amplience packages from this repo and loads
                published content live from the Amplience CDN.
            </p>
            <ul className="home-page__list">
                <li>Hub: <code>{hubName || '(set AMPLIENCE_HUB_NAME in repo .env)'}</code></li>
                <li>Console packages: <code>packages/amplience-core</code>, <code>packages/amplience-react</code></li>
            </ul>
            <Link className="home-page__cta" to={demoUrl}>Open Amplience demo</Link>
        </section>
    );
}
