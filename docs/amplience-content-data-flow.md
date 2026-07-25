# Amplience Content — Data Flow & Architecture

This page documents how Amplience content moves through the **B2C Migration Console**, **SFCC**, and the **React storefront**. Use it as the reference for implementation decisions and Confluence documentation.

---

## Summary

| Question | Answer |
|----------|--------|
| Does React fetch content directly from Amplience? | **Partially.** Live **published bodies** are fetched from the **Amplience CDN**. |
| Does content go through SFCC first? | **Yes.** The Migration Console wizard imports content into SFCC. SFCC is the **system of record** for migrated component inventory. |
| What does SFCC store? | Content assets in the `amplience/` library folder with `amplienceContentId`, `amplienceDeliveryKey`, `amplienceWidgetType`, `amplienceSourceJson`, and related custom attributes. |
| What does React use SFCC for? | **Catalog** (component list, search, filters) via `AmplienceContent-List`. **Page composition** via Headless Page Designer + SCAPI. |
| What does React use Amplience for? | **Live published content** (banner HTML, images, rich text) via CDN using IDs/keys stored on SFCC assets. |

**Bottom line:** Import into SFCC first (wizard). React does **not** replace SFCC for catalog or page structure. React **does** fetch live published payloads from Amplience CDN using references stored on migrated SFCC assets — the same pattern as the SFCC storefront live refresh.

---

## End-to-end data flow

```
┌─────────────────────┐
│  Amplience CMS      │
│  (Management API +  │
│   CDN)              │
└─────────┬───────────┘
          │
          │ ① Fetch & transform (BM Content Migration wizard)
          ▼
┌─────────────────────┐
│  Migration Console  │
│  bm_accelerator     │
│  contentMigration/  │
└─────────┬───────────┘
          │
          │ ② IMPEX import → Content Library
          ▼
┌─────────────────────────────────────────────────────────┐
│  SFCC (app_custom_amplience)                            │
│  • amplience/ content folder                            │
│  • Per-asset metadata (contentId, deliveryKey, JSON)    │
│  • AmplienceContent-Show  (ISML gallery)                │
│  • AmplienceContent-List  (JSON catalog for React)      │
│  • Optional CDN refresh on render (resolveLiveContent)  │
└─────────┬───────────────────────────────┬───────────────┘
          │                               │
          │ ③ Catalog / page refs         │ ④ Live bodies (published)
          ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│  React storefront   │         │  Amplience CDN        │
│  • Gallery (SFCC)   │────────►│  (hub.cdn.content.   │
│  • Demo / PD widgets│  fetch  │   amplience.net)    │
└─────────────────────┘         └─────────────────────┘
```

---

## Layer 1 — Migration (BM Content Migration wizard)

**Purpose:** Move Amplience content into SFCC as first-class content assets.

| Step | Component | Description |
|------|-----------|-------------|
| 1 | `amplienceContentFetcher` | Reads content from Amplience Management API / CDN |
| 2 | `amplienceContentTransformer` | Maps Amplience schemas to SFCC widget types (`mainBanner`, `editorialRichText`, etc.) |
| 3 | `contentXmlBuilder` | Generates IMPEX XML with custom attributes |
| 4 | IMPEX import | Creates assets under the `amplience/` content folder |
| 5 | BM Step 2 preview | Shows Amplience content IDs for storefront testing |

**SFCC custom attributes on each migrated asset:**

| Attribute | Purpose |
|-----------|---------|
| `amplienceContentId` | Amplience UUID |
| `amplienceDeliveryKey` | Published delivery key (may be empty until published) |
| `amplienceWidgetType` | Mapped widget type for rendering |
| `amplienceSourceJson` | Full source snapshot (offline / fallback) |
| `amplienceWidgetAttributes` | Transformed render attributes |
| `amplienceSchema` | Amplience content type schema URI |

**BM entry point:** `Accelerator-ContentMigration`

---

## Layer 2 — SFCC storefront (catalog & live refresh)

**Cartridge:** `app_custom_amplience`

| Endpoint | Type | Purpose |
|----------|------|---------|
| `AmplienceContent-Show` | ISML | Component gallery — lists migrated SFCC assets |
| `AmplienceContent-List` | JSON | Same catalog for React (`ok`, `items`, pagination, filters) |
| `AmplienceContent-Include` | Remote include | Single live component card |

**How SFCC renders one component:**

1. Load asset from ContentMgr (`resolveFromContentAsset`) — uses migrated snapshot.
2. If live mode enabled, refresh from Amplience CDN (`resolveLiveContent`) using stored `contentId` / `deliveryKey`.
3. Fall back to migrated JSON if CDN is unavailable.

**Important:** The gallery list reads **only the SFCC `amplience/` folder**, not the full Amplience hub.

---

## Layer 3 — React storefront

**Location:** `react-storefront/` + shared packages `packages/amplience-core`, `packages/amplience-react`

### Catalog (SFCC-first)

React loads the **same migrated catalog** as `AmplienceContent-Show`:

| Priority | Source | When used |
|----------|--------|-----------|
| 1 | `AmplienceContent-List` (SFCC API) | Production / dev with SFCC proxy |
| 2 | `public/amplience-catalog.json` | Offline dev; synced via `npm run sync:sfcc-catalog` |
| 3 | Amplience Management API export | **Dev fallback only** when SFCC List is unavailable |

Gallery UI: `/amplience-gallery` — search, type filters, Published on CDN filter.

### Live content rendering (Amplience CDN)

Preview page: `/amplience-demo?ids=CONTENT-UUID`

| Hook / component | Behaviour |
|------------------|-----------|
| `useAmplienceContent` | Fetches published content from Amplience CDN by `contentId` or `deliveryKey` |
| `AmplienceRenderer` | Renders widget by `widgetType` |
| `AmpliencePdWidget` | Headless Page Designer wrapper — uses `hubName` + `deliveryKey` from PD |

IDs in the demo URL should come from the **SFCC-migrated catalog** (BM wizard Step 2 or React gallery Preview).

### Headless Page Designer flow

**Cartridge:** `app_custom_headless`

1. Merchandiser builds a headless page in BM Page Designer.
2. Adds **Amplience Content Widget** with `hubName`, `deliveryKey`, optional `targetWidget`.
3. React app loads page JSON via SCAPI.
4. `AmpliencePdWidget` fetches live content from Amplience CDN.
5. Falls back to `previewHtml` from migration if CDN fails.

---

## Dev-only behaviours (not production architecture)

| Behaviour | Location | Production replacement |
|-----------|----------|------------------------|
| Management API catalog export (`export:amplience-catalog`) | `scripts/export-amplience-catalog.js` | Deploy SFCC; use `AmplienceContent-List` |
| Draft preview middleware (`/amplience-preview`) | `react-storefront/amplience-preview-middleware.cjs` | Publish content to CDN |
| Direct Amplience hub listing (161+ items) | Fallback when SFCC unavailable | SFCC folder = migrated subset only |

---

## Shared packages

| Package | Used by | Role |
|---------|---------|------|
| `@royalcyber/amplience-core` | SFCC + React | CDN URLs, transform, `fetchLiveContent()` |
| `@royalcyber/amplience-react` | React | Components, hooks, Page Designer registration |

Keep SFCC in sync after core changes:

```bash
npm run sync:amplience-core
npm run upload:amplience
```

---

## Recommended implementation checklist

1. Run BM **Content Migration** wizard — import selected Amplience content into SFCC.
2. Deploy cartridges: `npm run upload:amplience`, `npm run upload:headless`.
3. Verify `AmplienceContent-List?page=1&pageSize=5` returns `"ok": true`.
4. Sync React catalog: `npm run sync:sfcc-catalog`.
5. Start React: `npm run start:react` — gallery should show **Source: sfcc** or **sfcc-file**.
6. Preview components via gallery **Preview** → `/amplience-demo?ids=...`.
7. For headless pages: configure Page Designer → register PD components in React → fetch pages via SCAPI.
8. Publish content in Amplience to CDN for live storefront delivery.

---

## Key URLs (local dev)

| URL | Purpose |
|-----|---------|
| `http://localhost:3001/amplience-gallery` | Browse migrated SFCC catalog |
| `http://localhost:3001/amplience-demo?ids=UUID` | Preview specific component(s) |
| SFCC `AmplienceContent-Show` | ISML gallery (same catalog as React) |
| SFCC `AmplienceContent-List` | JSON catalog API for React |

---

## Related documentation

| Document | Location |
|----------|----------|
| React storefront setup | `react-storefront/README.md` |
| Amplience packages | `packages/README.md` |
| PWA Kit drop-in | `packages/amplience-pwa-demo/README.md` |
| Migration Console overview | `docs/project-overview.md` |
| Agent brief | `AGENTS.md` |
