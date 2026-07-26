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

## Amplience content architecture
- **Catalog:** SFCC `amplience/` folder → `AmplienceContent-List` (React gallery reads this, not the full Amplience hub)
- **Live bodies:** Amplience CDN via `contentId` / `deliveryKey` on migrated SFCC assets
- **Full flow:** `docs/amplience-content-data-flow.md` (Confluence-ready)
