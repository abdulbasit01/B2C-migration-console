import React from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';
import AmplienceDemoPage from './pages/AmplienceDemoPage';
import AmplienceGalleryPage from './pages/AmplienceGalleryPage';

export default function App() {
    return (
        <div className="app-shell">
            <header className="app-shell__header">
                <Link to="/" className="app-shell__brand">Royal Cyber Storefront</Link>
                <nav className="app-shell__nav">
                    <Link to="/">Home</Link>
                    <Link to="/amplience-gallery">Component gallery</Link>
                    <Link to="/amplience-demo">Amplience demo</Link>
                </nav>
            </header>
            <main className="app-shell__main">
                <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/amplience-gallery" element={<AmplienceGalleryPage />} />
                    <Route path="/amplience-demo" element={<AmplienceDemoPage />} />
                </Routes>
            </main>
        </div>
    );
}
