# Installation Guide — B2C Migration Console

Cartridge: `bm_accelerator` · Version: 1.0.0

## Prerequisites

- Salesforce B2C Commerce sandbox or realm with Business Manager access
- Account Manager API client with OCAPI Data API access (for attribute/schema operations)
- Source platform credentials (Shopify Admin API and/or commercetools API client)

## 1. Import metadata

Import the archive contents under `metadata/`:

1. **Administration → Site Development → Site Import & Export**
2. Upload a ZIP containing:
   - `services.xml` (at archive root or under `services/`)
   - `meta/system-objecttype-extensions.xml`
3. After import, verify:
   - **Administration → Operations → Services** shows `accelerator.*` services
   - **Merchant Tools → Site Preferences → Custom Preferences** shows group **B2C Migration Console**

### Service IDs

| Service ID | Use |
|------------|-----|
| `accelerator.http.generic` | Generic HTTP (fallback) |
| `accelerator.shopify.api` | Shopify Admin REST/GraphQL/OAuth |
| `accelerator.ctp.api` | commercetools Auth + API |
| `accelerator.sfcc.ocapi` | SFCC OCAPI / Account Manager |
| `accelerator.sfcc.webdav` | IMPEX WebDAV |
| `accelerator.amplience.api` | Amplience Management API, Auth, and CDN |

Credential URLs are placeholders; runtime code sets the full URL per call.

## 2. Deploy the cartridge

1. Upload `bm_accelerator` (e.g. `npm run upload:accelerator`).
2. **Administration → Sites → Manage Sites → Business Manager → Settings**
3. Add `bm_accelerator` to the cartridge path (before other cartridges is fine).
4. Activate the code version if needed.

## 3. Grant module permissions

1. **Administration → Organization → Roles → (role) → Business Manager Modules**
2. Enable **B2C Migration** / menu actions under the site.

## 4. Configure preferences

Open **Site Preferences → B2C Migration Console** and set:

- Shopify store URL, client ID, client secret/token, API version (if using Shopify)
- commercetools project key, client ID/secret, auth/API URLs (if using CTP)
- Amplience hub name, Personal Access Token, optional default delivery key (if using Amplience CMS)
- OCAPI client ID, BM username/password, OCAPI version

The migration wizard **does not** collect credentials on a form. Use **Test Connection** after preferences are set.

Deploy the cartridge with `npm run upload:accelerator` (`dw.json` is only for WebDAV upload auth).

## 5. Verify

1. Open **Merchant Tools → B2C Migration → Start Migration Wizard**
2. Run **Test Connection** for the source platform
3. Confirm no CSRF / 403 errors on AJAX actions

## Upgrade notes

- Re-import metadata when preference or service definitions change
- Compare cartridge `bm_accelerator.properties` version with release notes
- Clear BM browser cache after static asset changes (`csrf.js`)
