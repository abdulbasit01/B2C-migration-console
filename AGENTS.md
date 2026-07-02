# B2C Migration Console — Agent Brief

Royal Cyber SFCC BM cartridge for schema + data migration from commercetools/Shopify.

## Quick map
- **Dashboard**: `Accelerator-Start` → `dashboard.isml`
- **Schema wizard**: `Accelerator-Wizard` (5 steps)
- **Data wizard**: `Accelerator-DataWizard` (connect → select type → type-specific)
- **Order export API**: `Accelerator-ExportOrders` (JSON)
- **Tests**: `test/unit/bm_accelerator/orders/`
- **CTP seeding**: `npm run seed:ctp-inventory` (5000 inventory records); `npm run seed:ctp-standalone-prices` (500 USD standalone prices)

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
