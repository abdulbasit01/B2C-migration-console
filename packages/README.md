# Amplience packages for React Retail App

Shared Amplience CDN fetch + widget transform logic, plus React components for Headless Page Designer.

## Packages

| Package | Purpose |
|---------|---------|
| `@royalcyber/amplience-core` | CDN URLs, content transform, `fetchLiveContent()` |
| `@royalcyber/amplience-react` | React components, `useAmplienceContent` hook, Page Designer registration |
| `amplience-pwa-demo` | Drop-in `/amplience-demo` page for Retail React App |

## Quick start (Retail React App)

### 1. Link packages into your PWA Kit app

From your Retail React App root:

```bash
npm install /path/to/B2C-migrationConsole/packages/amplience-core
npm install /path/to/B2C-migrationConsole/packages/amplience-react
```

Or add to `package.json`:

```json
{
  "dependencies": {
    "@royalcyber/amplience-core": "file:../B2C-migrationConsole/packages/amplience-core",
    "@royalcyber/amplience-react": "file:../B2C-migrationConsole/packages/amplience-react"
  }
}
```

### 2. Import styles

In your app entry (e.g. `app/main.jsx`):

```javascript
import '@royalcyber/amplience-react/src/styles/amplienceContent.css';
```

### 3. Register Page Designer components

```javascript
import {registerAmpliencePageDesignerComponents} from '@royalcyber/amplience-react';

const amplienceComponents = registerAmpliencePageDesignerComponents();
// Merge amplienceComponents into your existing Page Designer component map
```

Registered types:

- `commerce_assets.mainBanner`
- `commerce_assets.campaignBanner`
- `commerce_assets.editorialRichText`
- `commerce_assets.imageAndText`
- `commerce_assets.amplienceWidget` (live CDN fetch by delivery key)

### 4. Render a banner directly (no Page Designer)

```jsx
import {AmplienceRenderer, useAmplienceContent} from '@royalcyber/amplience-react';

function HeroBanner() {
    const {model, loading, error} = useAmplienceContent({
        hubName: process.env.AMPLIENCE_HUB_NAME,
        deliveryKey: 'hero'
    });

    if (loading) return null;
    if (error) return <p>{error.message}</p>;
    return <AmplienceRenderer model={model} />;
}
```

## SFCC sync

Keep SFCC helpers aligned with the shared package:

```bash
node scripts/sync-amplience-core-to-sfcc.js
npm run upload:amplience
```

This copies `packages/amplience-core/src` into `cartridges/app_custom_amplience/.../amplienceCore/`.

## Architecture — data flow

See **[Amplience Content — Data Flow & Architecture](../docs/amplience-content-data-flow.md)** for the full Confluence-ready document.

| Layer | Source | Role |
|-------|--------|------|
| Migration | BM Content Migration wizard | Amplience → SFCC `amplience/` folder (IMPEX) |
| Catalog | SFCC `AmplienceContent-List` | What components exist (React gallery) |
| Live render | Amplience CDN | Published banner/rich-text bodies |
| Pages | SFCC Headless Page Designer | Page composition via SCAPI |

React fetches live content from Amplience CDN using `contentId` / `deliveryKey` stored on SFCC migrated assets. SFCC remains the system of record for migrated inventory.

## Tests

```bash
npm run test:amplience-core
```

## SFCC Headless Page Designer setup

1. Deploy storefront + BM: `npm run upload:amplience`, `npm run upload:accelerator`
2. `amplienceWidget.json` lives in `app_custom_amplience/cartridge/experience/`
3. In BM Page Designer, add **Amplience Content Widget** to a headless page region
4. Set `hubName` and `deliveryKey` — React fetches live content from Amplience CDN

No SFCC library import is required for live content updates.

## PWA Kit demo page

See `packages/amplience-pwa-demo/README.md` for copying `/amplience-demo` into your Retail React App.
