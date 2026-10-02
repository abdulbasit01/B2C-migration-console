# Inventory Migration – commercetools to SFCC

Last updated: 1 Oct 2026

Inventory migration works end to end on the sandbox: the EU Warehouse imported with 0 errors and the RefArch storefront shows the migrated stock; the US Warehouse imported with 1 error, on a test SKU.

## Page properties

| Property | Value |
| --- | --- |
| Status | Code complete and verified on the sandbox; merge after the order PR |
| Scope | Inventory from commercetools project mars-mms-test-us into SFCC (sandbox zzkc-009, site RefArch) |
| Tool | Migration console, cartridge bm_accelerator (Business Manager) |
| Code branch | Not committed yet; goes in its own branch once feature/ct-order-migration is merged |
| Contract | SFCC inventory.xsd (repo copy, .cursor/references/sfcc-xsd/inventory.xsd) |
| Volume | 3,803 inventory entries: 6 channels plus 6 entries without a channel |
| Depends on | Product migration (SFCC product IDs), inventory list assigned to each site |

## Summary

Inventory migration from commercetools to SFCC works end to end on sandbox zzkc-009. The EU Warehouse imported with 0 errors and the RefArch storefront shows the migrated stock. The US Warehouse imported with 1 error, on a test SKU.

| | EU Warehouse | US Warehouse |
| --- | --- | --- |
| Records exported | 893 | 2,507 |
| Import errors | 0 | 1 (test SKU stored twice) |
| Import warnings | 1 | 3 |
| Records with no SFCC product (SKU kept) | 119 | 1,047 |
| SFCC inventory list | migrated-inventory_eu-warehouse-channel | migrated-inventory_us-warehouse-channel |
| Read by a site | RefArch | not assigned yet |

- Six issues in the inventory module were fixed: product IDs, spaces in IDs, timestamps, bundles, backorder fields and file naming. No further code fix is required.
- The remaining error and warnings come from commercetools data, not from the code.
- Still open: four business decisions (see Open decisions) and merging the code after the order PR.

## Scope and flow

commercetools holds 3,803 inventory entries. The EU and US warehouse channels (3,400 entries) are migrated, each into its own SFCC inventory list. Only EU feeds a site today.

| commercetools channel | Entries | SFCC inventory list | Site that reads it |
| --- | --- | --- | --- |
| EU Warehouse | 893 | migrated-inventory_eu-warehouse-channel | RefArch (storefront verified) |
| US Warehouse | 2,507 | migrated-inventory_us-warehouse-channel | none yet (decision open) |
| cs-sales and 3 store channels | 397 | not migrated yet (decision open) | – |
| No channel | 6 | not migrated | – |

The migration console exports one file per channel; a Business Manager import (MERGE) loads it into its list. A site reads exactly one inventory list, so a list reaches a storefront only once it is assigned to that site.

## Field mapping

Every commercetools inventory field maps to a native inventory.xsd element; only custom fields without a native element become custom attributes.

| commercetools inventory entry | SFCC record element (inventory.xsd) | Rule |
| --- | --- | --- |
| sku | product-id | The SFCC product found through the commercetools product: a variant is {productId}-{n}, a single product or bundle is the product ID. No match: the SKU is kept, spaces trimmed. |
| quantityOnStock | allocation | Total stock; a negative value becomes 0. |
| (export time) | allocation-timestamp | Time of the export, so later re-imports are accepted. |
| none | perpetual | Always false. |
| availableQuantity, expectedDelivery, restockableInDays | preorder-backorder-handling | Stock available: none. Expected delivery set: preorder. Restockable in N days: backorder. |
| custom field maxBackorderQuantity | preorder-backorder-allocation | Native element instead of a custom attribute. |
| expectedDelivery or restockableInDays | in-stock-datetime | Preorder: the expected delivery. Backorder: export time plus N days. |
| other custom fields | custom-attributes | Kept as custom attributes. |
| supplyChannel | inventory list (header list-id) | One file and one SFCC inventory list per channel. |
| availableQuantity | none (ats is export-only) | SFCC computes available-to-sell itself. |

Each file's header sets the list ID chosen in the console, default-instock false, use-bundle-inventory-only false and on-order false.

## Issues found and fixes

Six issues were fixed and each is proven on the sandbox. Issues 1, 2, 3, 5 and 6 were in the original inventory module; issue 4 appeared once SKUs were mapped to SFCC products by fix 1.

| # | Symptom | Root cause | Fix | Proof on the sandbox |
| --- | --- | --- | --- | --- |
| 1 | Imported stock never showed on the storefront | product-id was the commercetools SKU, but SFCC products are named after the commercetools product ID ({productId}-{n}) | Look up each SKU's product and variant in commercetools (GraphQL, 100 SKUs per call) and apply the same SFCC ID rule as the order migration | Tütchen 40 g, Grußkarte and the bundle show In Stock |
| 2 | A whole file could fail XSD validation | 3 SKUs start with a space; inventory.xsd forbids spaces around product-id | Trim product-id | No spaced IDs; all files pass the XSD |
| 3 | Re-imports refused: "New allocation reset date before last allocation" and the 48-hour quota | allocation-timestamp was the entry's last change date, up to four years old | Use the export time | Re-import into an existing list: 0 errors. A pre-fix file had 871 of 893 records refused |
| 4 | A bundle got the wrong stock: 41cbb1eb… 30,287 instead of 1,635 | Every variant SKU of a bundle mapped to the one SFCC bundle, so a test SKU's record won | Only the master variant's stock goes to a product that has no variants in SFCC; other SKUs are kept separately | ATS 1,635 |
| 5 | Backorder warnings; the backorder limit ended up as a custom attribute | No in-stock date was written; maxBackorderQuantity was a custom attribute | Native in-stock-datetime and preorder-backorder-allocation | M1 shows "in stock 6 Oct"; the warning narrowed to the missing amount (data) |
| 6 | Every export of a channel on the same day was named -v001, and an old file was imported by mistake | The existing-file check used WebDAV basic auth, which fails on this sandbox | Check the export folder in IMPEX directly, giving -v002, -v003 | Unit tests pass; visible on the next export |

## Sandbox test results

The final EU import had 0 errors and the US import 1 error on a test SKU. Storefront and Shop API checks match the imported files.

Import runs on 1 Oct 2026, newest first (times in GMT):

| Time | File and target list | Records | Errors | Warnings | Note |
| --- | --- | --- | --- | --- | --- |
| 12:32 | US Warehouse → migrated-inventory_us-warehouse-channel | 2,507 | 1 | 3 | The error is a test SKU stored twice in commercetools |
| 12:15 | EU Warehouse, all fixes → migrated-inventory_eu-warehouse-channel | 893 | 0 | 1 | Final EU import |
| 12:11 | EU Warehouse, pre-fix file picked by mistake → same list | 893 | 871 | 0 | The 48-hour rule refused the old timestamps; nothing changed |
| 11:55 | EU Warehouse, all fixes → inventory_m (test list) | 893 | 0 | 1 | First test of fixes 3 to 5 |
| 11:38 | EU Warehouse, fixes 1 and 2 only → migrated-inventory_eu-warehouse-channel | 893 | 3 | 1 | Bundle duplicates (issue 4) |

Storefront (de_CH) and Shop API checks after the final imports:

| Product | Checked in | Result |
| --- | --- | --- |
| Tütchen 40 g (98f72c33-…-1) | Storefront | In Stock, stock 116,236 |
| M&Ms Grußkarte (ca356ad1-…-1) | Storefront | In Stock |
| Bundle 1,5 kg-Beutel (41cbb1eb-…) | Shop API and storefront | ATS 1,635 (was 30,287), In Stock |
| M&M'S Character lounge item (8bf58fc8-…-1) | Storefront | Not available, in stock 6 Oct; matches commercetools (0 stock, restock in 5 days) |
| 8 sampled US products | Shop API | 5 of 5 checkable products match the file; 3 have no category and cannot be checked this way |

## Known data warnings

Every remaining warning, and the one US error, comes from commercetools data; none needs a code change.

| Item | Records | What happens in SFCC | Why |
| --- | --- | --- | --- |
| Backorder or preorder without a quantity | EU 1 (8bf58fc8-…-1); US 3 (344567, fa213b47-…-1, 71c9d927-…-1) | Warning "missing future amount"; the product is not orderable | commercetools holds no backorder quantity, and its available stock is 0 too |
| Test SKU stored twice (fv-peanut-test, once with a leading space) | US 1 | 1 import error; the stored stock is still right (1) | Duplicate entry in commercetools |
| SKUs that are on no commercetools product | EU 116, US 1,040 | Kept as records under the SKU; no storefront effect | Stale or test inventory in commercetools |
| Extra variants of products that have no variants in SFCC | EU 3, US 5 (e.g. 9139test, 2lb-001) | Kept as records under the SKU | Only the master variant's stock goes to the product (issue 4) |
| Other test data | US 2 | Kept as records under the SKU | aqa-701130-90014 (QA product, leading space) and 701133-J8118 (unpublished SKU, stock 0) |
| Products without a category (e.g. Grußkarte) | not counted | The Shop API cannot see them; the product page works | Catalog assignment, not inventory |

Only 3 SKUs in the whole project have spaces around them, all test data.

## Open decisions

Four decisions are open. None blocks testing, but all are needed before go-live.

| Decision | Options | Recommendation |
| --- | --- | --- |
| Which channels to migrate, and which site reads each list | EU and US warehouse lists, one per site. Four more channels (cs-sales and 3 store channels, 397 entries) plus 6 entries without a channel | One list per channel, each assigned to its site. Decide whether the store channels should feed store inventory |
| Stock of products that are one SFCC product but several commercetools variants (bundles, sets, and products such as eee5629e… with 2lb, 5lb and 10lb sizes) | Master variant only (current) or the sum of all variants | Keep the master variant, which matches the price rule. Ask the product team why those sizes are not separate SFCC products |
| SKUs that are on no commercetools product (1,156 in EU and US) | Keep as records (current) or skip them | Skip them, since they can never be sold; keep them only if an audit trail is needed |
| Placeholder stock of 1,000,000 or more (EU 29, US 96, e.g. 9,999,999) | Keep the number (current) or mark the record perpetual | Confirm what the placeholders mean; if they mean "unlimited", use perpetual |

## Go-live runbook

Import each channel's file within 48 hours of its export, and export as close to cutover as possible.

1. In the migration console, export one channel at a time and keep the list ID migrated-inventory_<channel>.
2. Note the file name in the final message (…-vNNN.xml) and the count of records with no SFCC product.
3. Download that file and upload it in Merchant Tools → Products and Catalogs → Import & Export.
4. Import it as Inventory in MERGE mode, selecting exactly that file name.
5. Check the import log: expect 0 errors, and warnings only for backorders without a quantity.
6. Assign each list to its site; a site reads one inventory list.

- **Why 48 hours:** allocation-timestamp is the export time, and SFCC refuses an update whose timestamp is more than 48 hours in the past.
- **Why export last:** stock changes all the time; 15 SKUs changed within 5 minutes during testing.
- **Optional:** a Business Manager job using the standard ImportInventoryLists step can import straight from src/migration/inventory, with no download or upload.

## Code changes and tests

The changes touch seven files in the bm_accelerator cartridge. They are deployed on the sandbox, covered by 20 new unit tests, and will be merged after the order PR.

| File | Change |
| --- | --- |
| inventoryMigration/ctpInventoryFetcher.js | Finds each SKU's SFCC product (GraphQL lookup, same resolver as the order migration) and applies the bundle rule |
| inventoryMigration/inventoryTransformer.js | Trims IDs, uses the export time as timestamp, writes native backorder fields, flags records with no SFCC product |
| inventoryMigration/inventoryXmlBuilder.js | Never writes a spaced product-id; writes the backorder elements in XSD order |
| inventoryMigration/fullMigrationRunner.js | Counts records with no SFCC product |
| inventoryMigration/inventoryFileNaming.js | Picks the next free -vNNN, checked in IMPEX |
| client/default/js/inventory-migration.js and controllers/Accelerator.js | Shows "N records with no matching SFCC product (SKU kept)" after an export |

- **Tests:** 4 new test files under test/unit/bm_accelerator/inventoryMigration (20 tests); the full unit suite passes (299 tests).
- **Other platforms:** Shopify and BigCommerce entries carry their own product IDs and pass through unchanged apart from trimming; a test covers this.
- **Status:** live on the sandbox code version ct-migration-consoile-product; to be merged in its own branch once feature/ct-order-migration is merged.
