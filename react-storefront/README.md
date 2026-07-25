# React Storefront (synced with B2C-migrationConsole)



Minimal React app that uses the shared Amplience packages from this repo.



## Architecture — how content flows



This app uses a **hybrid** model aligned with the Migration Console:



| Layer | Source | What React uses it for |

|-------|--------|------------------------|

| **Catalog** | SFCC (`AmplienceContent-List`) | Component gallery — which items were migrated |

| **Live bodies** | Amplience CDN | Banner, rich text, images for published content |

| **Page layout** | SFCC Headless Page Designer + SCAPI | Composed storefront pages (PWA Kit path) |



```

Amplience CMS

    │

    ▼  BM Content Migration wizard (IMPEX)

SFCC amplience/ folder  ──►  AmplienceContent-List  ──►  React gallery

    │

    └── contentId / deliveryKey on each asset

              │

              ▼  fetchLiveContent()

        Amplience CDN  ──►  React demo + PD widgets

```



**Rules:**



- Content is **imported into SFCC first** via the Migration Console wizard. SFCC is the system of record for *what* was migrated.

- React **does not** list the full Amplience hub in production. The gallery shows the SFCC migrated catalog only.

- React **does** fetch **published** live payloads directly from Amplience CDN using `contentId` / `deliveryKey` stored on SFCC assets (same as SFCC `resolveLiveContent`).

- Draft / unpublished preview (`/amplience-preview`) and Management API catalog export are **dev fallbacks only**.



Full architecture (Confluence-ready): [`docs/amplience-content-data-flow.md`](../docs/amplience-content-data-flow.md)



---



## Start



From repo root:



```bash

npm run start:react

```



Or from this folder:



```bash

npm install

npm run dev

```



Open:



- http://localhost:3001/

- http://localhost:3001/amplience-gallery

- http://localhost:3001/amplience-gallery?type=editorialRichText

- http://localhost:3001/amplience-gallery?q=hero

- http://localhost:3001/amplience-gallery?published=1

- http://localhost:3001/amplience-demo

- http://localhost:3001/amplience-demo?ids=ba65f899-6545-4a21-8f09-00387d3a4b7d,YOUR-RICH-TEXT-ID



## Component gallery (React)



React loads the **same migrated SFCC catalog** as `AmplienceContent-Show` via:



1. **Live SFCC API** (dev proxy auto-configured from `dw.json` hostname)

2. **Synced file** `react-storefront/public/amplience-catalog.json`



Sync all SFCC migrated components before starting:



```bash

npm run sync:sfcc-catalog

npm run start:react

```



`npm run start:react` runs the sync automatically.



The gallery shows **Source: sfcc** when live, or **sfcc-file** when using the synced JSON.



| Gallery feature | URL param |

|-----------------|-----------|

| Type filter | `?type=mainBanner` |

| Search | `?q=hero` |

| Published on CDN only | `?published=1` |



Optional overrides in repo root `.env`:



```

SFCC_SITE_ID=MigrationConsole

SFCC_LOCALE=en_US

VITE_SFCC_STOREFRONT_URL=https://your-sandbox.dx.commercecloud.salesforce.com/on/demandware.store/Sites-MigrationConsole-Site/en_US

```



## Amplience demo page



`/amplience-demo` previews specific content by ID — use **Preview** from the gallery or pass `?ids=UUID`.



- No type/search filters on this page (filtering belongs on the gallery).

- Published content loads from Amplience CDN.

- Unpublished content shows a draft preview in dev (Management API fallback).



## Hub name



The app reads `AMPLIENCE_HUB_NAME` from the **repo root** `.env` (same file as the migration console).



Optional — default rich text content id for the demo page:



```

VITE_AMPLIENCE_DEFAULT_RICH_TEXT_ID=your-amplience-uuid-here

```



You can override per URL with `?hub=your-hub`.



## Sync with console



| Console change | React action |

|----------------|--------------|

| Edit `packages/amplience-*` | Restart `npm run dev` |

| Change `.env` hub name | Restart dev server |

| Publish content in Amplience CDN | Refresh browser |

| Run Content Migration wizard / re-import | `npm run sync:sfcc-catalog` |

| Upload SFCC cartridges | `npm run upload:amplience` etc. in repo root |



## Deploy checklist



1. Run BM Content Migration wizard and import into SFCC.

2. `npm run upload:amplience` — deploy storefront cartridge.

3. Verify `AmplienceContent-List?page=1&pageSize=5` returns `"ok": true`.

4. `npm run sync:sfcc-catalog` then `npm run start:react`.



## Upgrade to full PWA Kit later



Copy `packages/amplience-pwa-demo/drop-in/` into a Salesforce Retail React App when you need SCAPI checkout and headless Page Designer pages.


