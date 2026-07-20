# B2C Migration Console (`bm_accelerator`)

Royal Cyber Business Manager cartridge for schema and data migration from commercetools and Shopify into Salesforce B2C Commerce.

**Version:** 1.0.0

## Contents

| Path | Purpose |
|------|---------|
| `cartridges/bm_accelerator` | BM extension cartridge |
| `metadata/services.xml` | Service Framework definitions (import required) |
| `metadata/meta/system-objecttype-extensions.xml` | Site preference definitions (import required) |
| `documentation/` | LINK installation and user guides |

## Guides in this folder

| File | Audience |
|------|----------|
| [link_installation.md](link_installation.md) | Installers — metadata, cartridge path, preferences |
| [link_user_guide.md](link_user_guide.md) | Operators — wizards and data flows |

Root [README.md](../README.md) is the project entry point.

## Quick start

1. Import `metadata/` as a site archive (services + SitePreferences).
2. Add `bm_accelerator` to the **Business Manager** site cartridge path.
3. Grant the **B2C Migration** module to BM roles.
4. Configure Site Preferences → **B2C Migration Console** (Shopify and/or CTP + OCAPI/BM credentials).
5. Open Merchant Tools → **B2C Migration**, then **Test Connection**.

Credentials are **not** collected on wizard forms.

## Configuration

| Setting | Where |
|---------|--------|
| Shopify / CTP / OCAPI / BM credentials | Site Preferences → B2C Migration Console |
| HTTP / Shopify / OCAPI / WebDAV timeouts | Administration → Operations → Services (`accelerator.*` profiles) |
| Cartridge upload hostname / WebDAV | Local `dw.json` only (not runtime) |

Runtime config is Site Preferences only.

## Security notes

- Do not commit `dw.json`.
- Rotate any credentials that were ever committed to source control.

## Development

```bash
npm run upload:accelerator   # upload cartridge (uses dw.json)
npm run lint:js
```
