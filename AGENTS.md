# B2C Migration Console — Agent Brief

Royal Cyber SFCC BM cartridge for schema + data migration from commercetools/Shopify.

## Quick map
- **Dashboard**: `Accelerator-Start` → `dashboard.isml`
- **Schema wizard**: `Accelerator-Wizard` (5 steps)
- **Data wizard**: `Accelerator-DataWizard` (connect → select type → type-specific)
- **Order export API**: `Accelerator-ExportOrders` (JSON)
- **Tests**: `test/unit/bm_accelerator/orders/`

## Order migration pipeline
`ctpOrderConnector` → `ctpOrderMapper` → `orderValidator` → `sfccOrderXmlGenerator` → `impexGenerator` → `orderMigrationRunner`

## Before editing
1. Read surrounding code in `Accelerator.js` / `migrationData.js`
2. Run `npm run lint:js` after JS changes
3. Deploy with `npm run upload:accelerator`

## Known pitfalls
- ISML: no CDATA in scripts; escape `&` in display strings
- Rhino: use `encodeURIComponent`, not `StringUtils.encodeURIComponent`
- `session.custom` flags are strings (`'true'`), not booleans

## CMS architecture (`app_custom_cms`)
- **Generic storefront cartridge** for headless CMS integrations (Amplience today; Contentful etc. later)
- **Amplience today:** `AmplienceContent-List` API, migrated content helpers under `scripts/helpers/amplience*`
- **React gallery:** reads `AmplienceContent-List` (not SFRA ISML storefront)
- **Catalog:** SFCC `amplience/` folder → `AmplienceContent-List`
- **Deploy:** `npm run upload:cms` (alias: `upload:amplience`)

## SFCC cartridge paths
| Site | Path |
|------|------|
| **Business Manager** | `bm_accelerator` |
| **Storefront** (CMS API for React) | `app_custom_cms:modules` |

`modules` is the standard SFCC routing cartridge (not in this repo). Add it from your SFCC/SFRA distribution on the storefront site path.

## Deploy all
```bash
npm run upload:accelerator
npm run upload:cms
```
