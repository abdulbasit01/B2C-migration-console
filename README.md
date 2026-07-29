# B2C Migration Console

Royal Cyber Salesforce B2C Commerce **Business Manager** cartridge (`bm_accelerator`) for schema and data migration from **commercetools** and **Shopify**.

**Cartridge version:** 1.0.0

## What it does

| Flow | Entry | Purpose |
|------|-------|---------|
| Schema wizard | Merchant Tools → B2C Migration → Start Migration Wizard | Fetch source attributes/metafields, map, create SFCC custom attributes |
| Data wizard | Same dashboard → Data Migration | Export orders, customers, products, inventory, price books, tax, stores, shipping methods, categories |
| Product wizard | B2C Migration → Product Catalog Wizard | Product-focused connect → configure → move |
| Config | Site Preferences → **B2C Migration Console** | All runtime credentials (Shopify, CTP, OCAPI/BM) |

Credentials are **not** entered in wizard forms. Configure Site Preferences, then use **Test Connection**.

## Documentation

| Doc | Description |
|-----|-------------|
| [documentation/README.md](documentation/README.md) | Package overview |
| [documentation/link_installation.md](documentation/link_installation.md) | Install, metadata import, cartridge path, preferences |
| [documentation/link_user_guide.md](documentation/link_user_guide.md) | Operator guide |

## Quick start

1. Import `metadata/` (Site Development > Import & Export): `meta/system-objecttype-extensions.xml`
2. Import `services` (Operations > Import & Export): `services.xml`
3. Upload the cartridge: `npm run upload:accelerator` (requires `dw.json` for WebDAV)
4. Add `bm_accelerator` to the **Business Manager** site cartridge path
5. Enable **B2C Migration** for BM roles
6. Set Site Preferences → **B2C Migration Console**
7. Open **Merchant Tools → B2C Migration** and run **Test Connection**

### Site preferences (group: B2C Migration Console)

- Shopify: store URL, client ID, client secret/token, API version
- commercetools: project key, client ID/secret, auth URL, API URL
- SFCC: OCAPI client ID, BM username/password, OCAPI version

Timeouts are configured in Service Framework profiles (`metadata/services.xml`), not site prefs.

### `dw.json` (upload only)

```json
{
    "hostname": "your-sandbox.dx.commercecloud.salesforce.com",
    "username": "you@company.com",
    "password": "your_webdav_access_key",
    "code-version": "version_to_upload_to"
}
```

Do not commit `dw.json`.

## NPM scripts

```bash
npm install
npm run upload:accelerator   # compile SCSS + upload bm_accelerator
npm run lint:js
npm test                     # unit tests (includes bm_accelerator order/bulk tests)
```

## Layout

```
cartridges/bm_accelerator/     BM extension cartridge
metadata/                      services.xml + SitePreferences metadata
documentation/                 LINK install / user / change docs
test/unit/bm_accelerator/      Unit tests
```

## Security

- Runtime secrets: Site Preferences only (password-typed where appropriate)
- Outbound HTTP: Service Framework (`accelerator.*` services)
- BM endpoints: auth + CSRF via `requestGuard.js`
- Never commit live credentials

## Note on SFRA leftovers

This repo started from SFRA scaffolding. The product deliverable is **`bm_accelerator`**. Prefer `npm run upload:accelerator` over full SFRA `uploadCartridge` unless you intentionally maintain storefront cartridges.
