# Royal Cyber B2C Migration Console (Commerce App)

Private Commerce App Package (CAP) for Salesforce B2C Commerce. Ships:

- **Business Manager** cartridge `bm_accelerator` — schema and data migration from commercetools, Shopify, BigCommerce, and SAP
- **Storefront** cartridge `app_custom_cms` — Amplience CMS helpers and `AmplienceContent-*` controllers
- **IMPEX** — `accelerator.*` services and `rcMig*` site preferences
- **Storefront Next** extension — Amplience component gallery (`royalcyber.home.cms.amplienceGallery`)

App id: `rc-b2c-migration-console` · Version: `1.0.0` · Domain: `cms` (private install; CMS hub domain is Wave 4)

This package is for **private** `b2c cap install` on customer sandboxes. It is not submitted to the Commerce App Registry.

## Install (private)

Prerequisites: [B2C CLI](https://salesforcecommercecloud.github.io/b2c-developer-tooling/) with OCAPI job permissions and WebDAV `/impex` access. `dw.json` or `SFCC_*` env vars for instance auth.

From the repository root:

```bash
npm run cap:validate
npm run cap:package
npx @salesforce/b2c-cli cap install ./dist/rc-b2c-migration-console-v1.0.0.zip --site-id YOUR_SITE_ID
```

Or from this directory after `npm run compile:scss` from the repo root:

```bash
npx @salesforce/b2c-cli cap validate .
npx @salesforce/b2c-cli cap package . --output ../dist
npx @salesforce/b2c-cli cap install ../dist/rc-b2c-migration-console-v1.0.0.zip --site-id YOUR_SITE_ID
```

Do **not** pass `--create-pr` unless the merchant has a Storefront Next GitHub connection. Use `b2c cap pull` and copy `storefront-next/` instead.

## After install

1. Enable **B2C Migration** on the BM role.
2. Confirm **Business Manager** cartridge path includes `bm_accelerator`.
3. Confirm **storefront** cartridge path includes `app_custom_cms:modules` (SFRA `modules` cartridge is not in this package).
4. Set Site Preferences → **B2C Migration Console**.
5. Open **Merchant Tools → B2C Migration** and run **Test Connection**.

## Uninstall

```bash
npx @salesforce/b2c-cli cap uninstall rc-b2c-migration-console --site-id YOUR_SITE_ID
```

Uninstall deletes `accelerator.*` services when the last site removes the app. Site preference **definitions** (`rcMig*`) are left in place.

## Cartridge layout in this CAP

```
cartridges/bm_cartridges/bm_accelerator
cartridges/bm_cartridges/app_custom_cms
```

Edit these folders in this CAP directory. `app_custom_cms` is BM-classified because site cartridges cannot include `controllers/`. After install, add it to the **storefront** cartridge path so `AmplienceContent-*` is reachable.

## Storefront Next

Extension: `storefront-next/src/extensions/rc-b2c-migration-console/`

- Target: `royalcyber.home.cms.amplienceGallery` (custom namespace, not `sfcc.*`)
- Data: `GET {storefrontOrigin}/AmplienceContent-List` from `app_custom_cms`
