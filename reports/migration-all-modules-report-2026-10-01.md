# commercetools to SFCC Migration – All Modules Report

Last updated: 1 Oct 2026

All five modules export valid SFCC files and were imported and checked on sandbox zzkc-009 (site RefArch). None is ready for the final production run yet: one site decision, some setup and a price book fix remain.

## Page properties

| Property | Value |
| --- | --- |
| Status | Code complete for all modules except 48 price book bundle rows; final run pending the EU/US site decision and setup |
| Scope | Products and catalog, price books, inventory, customers and orders from commercetools project mars-mms-test-us into SFCC |
| Sandbox | zzkc-009, site RefArch, code version ct-migration-consoile-product |
| Tool | Migration console, cartridge bm_accelerator (Business Manager) |
| Contracts | SFCC XSDs in .cursor/references/sfcc-xsd/ (catalog, pricebook, inventory, customer, order) |
| Volume | 876 products (2,097 variants), 6,782 price rows, 3,803 inventory entries, 103,377 customers, 102,578 orders |

## Summary

| Module | Code | Sandbox result | Blocks the final run |
| --- | --- | --- | --- |
| Product and catalog | Done; merged (PR #32) | Catalog imported; products and prices show on the storefront | Nothing |
| Price book | Done, except 48 bundle rows | CHF price book imported; CHF prices show on the storefront | 48 bundle rows, to be fixed in the price book PR |
| Inventory | Done; to be merged after the order PR | EU: 893 records, 0 errors, verified on the storefront. US: 2,507 records, 1 error on a test SKU | Which inventory list each site reads |
| Customer | Done | 102,968 of 103,377 customers imported | EU/US customer lists (396 customers exist in both regions) |
| Order | Done; PR in review. A store filter is still needed if EU and US become two sites | 24,770 orders (old code) and 511 orders (new code) imported; all files valid against order.xsd | Create 7 attributes, EU/US customer lists, store filter, sandbox reset |

- **One decision unblocks most of the remaining work:** whether EU and US run as separate SFCC sites.
- **Final run order:** catalog, price books, inventory, customers, then orders, on a reset sandbox.
- Each module section below lists scope, how it works, issues fixed, test results and open items.

## Migration order and dependencies

The final run follows the dependencies between modules: catalog first, orders last. Before any import: site setup (EU/US), locales, currencies, and customer and inventory lists per site.

| Step | Module | Needs first | Status |
| --- | --- | --- | --- |
| 1 | Catalog | Site setup | Done; 0 import errors. Its product IDs are used by all other modules |
| 2 | Price books | Catalog | 48 bundle rows to fix in the price book PR |
| 3 | Inventory | Catalog | Done; EU 0 errors. Assign a list per site |
| 4 | Customers | Site setup (customer lists) | Done; 102,968 imported. EU/US lists to decide |
| 5 | Orders | Catalog and customers | Done; PR in review. 4 setup items first |

Price books and inventory need the catalog's product IDs. Orders need both the products and the customers, so customers are imported before orders.

## 1. Product and catalog

The catalog migration is complete: 876 commercetools products (2,097 variants) became 2,884 SFCC products and imported with 0 errors.

### How it works

1. **Pre-flight check:** the console lists commercetools attributes missing in SFCC and creates them. Localized enums used as variation attributes are created non-localizable, as SFCC requires.
2. **Export:** products are exported in chunks into multi-part XML files in IMPEX (src/migration/product/), built piece by piece to stay under SFCC's 1,000,000-character script string quota.
3. **Download:** files download in parts, so files over Business Manager's 10 MB page limit still arrive as valid XML.
4. **Import:** Business Manager catalog import; categories are assigned in the same file.

**ID rules, also used by price books, inventory and orders:** a master is the commercetools product ID; a variant is {productId}-{n} by position (the master variant is -1); single products, bundles and sets use the product ID. Images sit on masters, because SFCC does not allow images on variation products.

### Issues fixed (PR #31 and PR #32)

| Issue | Fix |
| --- | --- |
| Large catalogs hit the script string quota | Chunked export, multi-part files, XML flushed to disk in pieces |
| Downloads over 10 MB saved an error page as .xml | Download in parts, joined and checked in the browser |
| Variation attributes rejected ("wrong type 'local'") | Localized enums used as variation attributes created non-localizable |
| Variation attributes not compatible with SFCC | Compatibility check before export |
| Images missing | Master and variation product images exported |
| Products wrongly exported as product sets | Product set detection fixed; large products built piece by piece |
| Custom data not mapped | Mapping to custom attributes, selected in the pre-flight check |

### Test results

- **Product file v002 (29 Sep):** 2,884 products, including 793 masters with variants and 75 bundles, plus 3,145 category assignments.
- **Import on zzkc-009 (DELETE, then MERGE):** 0 errors and 5 warnings; the 5 bundles each reference a member product that is not in the catalog.
- **Validation:** checked against the full commercetools dump (876 products) with the product validator script.
- **Storefront:** products and prices show, for example Grußkarte at CHF 3,50 and the tier prices of Tütchen 40 g.

### Open items

| Item | Impact | Type |
| --- | --- | --- |
| 59 products have no category | Not in navigation or search, and the Shop API cannot see them; the product page works by link | Catalog data |
| 10 masters do not switch images when a variant is picked | Cosmetic; the master images show | Enhancement |
| Product page shows an attribute labelled "OpenAI Dimensions" and literal `<br>` tags | Text attributes were created as string instead of html | Fix in attribute mapping |
| Products with several commercetools variants but no variation attributes (e.g. eee5629e… with 2lb, 5lb and 10lb sizes) become one SFCC product | The extra sizes cannot be sold separately | Question for the product team |
| 5 bundles reference member products that are not exported | Each bundle imports without that member | commercetools data |

## 2. Price book

Prices now reach SFCC products: on the CHF price book, all 217 linked prices checked against commercetools match, tiers included. 48 bundle rows still need to be fixed in the price book PR.

### How it works

- **Source:** prices embedded in commercetools variants: 6,782 price rows on 1,959 of 2,097 variants, with no standalone prices.
- **Currencies in commercetools:** USD (1,427 variants), EUR (681, across 13 countries), GBP (605), DKK (359), PLN (351), CHF (274).
- **Output:** one price book per currency (e.g. product-list-prices-chf), quantity tiers carried over, written to IMPEX src/migration/pricebook/ and imported in Business Manager.
- **On the site:** each price book must be assigned to the site, and its currency allowed on the site.

### Issues and status

| # | Issue | Status |
| --- | --- | --- |
| 1 | Prices were written under the commercetools SKU, not the SFCC product ID (0 of 907 matched) | Fixed in the price book PR; the CHF file now links 223 rows to products |
| 2 | Customer-group prices became the list price (20 cases) | Fixed in the price book PR; 0 in the CHF file |
| 3 | Expired prices were used (7 cases) | Fixed in the price book PR; 0 in the CHF file |
| 4 | Bundles are written as {productId}-1, but SFCC holds a bundle under its plain product ID: 48 rows, about 30 products without a CHF price | To be fixed in the price book PR. A bundle with several variants (41cbb1eb…) takes the master variant's price |
| 5 | Whitespace in product IDs broke pricebook.xsd | Fixed (PR #32) |
| 6 | Only GBP and CHF got a full price book; EUR, USD, PLN and DKK did not | Generate all six currencies |
| 7 | EUR prices differ by country for 142 variants, but one EUR price book keeps one price | Decision, then code |
| 8 | 61 channel prices become per-channel price books, and SFCC price books have no channel | Decision: skip, or map to sites |
| 9 | 138 variants have no price in commercetools | commercetools data |

### Test results (CHF, 1 Oct)

- **File:** pricebook-emb_agg_chf-20260930-v002.xml, valid against pricebook.xsd.
- **Import:** 271 prices, 0 errors, 0 warnings.
- **Product IDs:** 223 rows link to catalog products (0 before the fix); 48 rows point to bundle IDs that do not exist.
- **Amounts:** 217 of 217 checked prices match live commercetools, tier prices included.
- **Storefront (de_CH):** Grußkarte shows CHF 3,50; Tütchen 40 g shows its tier prices.

### Open items

- Fix the 48 bundle rows in the price book PR, then regenerate the file and import it with REPLACE, which also removes the wrong rows.
- Generate the other five currencies.
- Decide EUR by country, channel price books, and the currency of each site. RefArch allows USD, EUR, JPY, CNY and CHF; GBP is not allowed.
- Exports of the same price book on the same day all get the name -v001, the issue already fixed for inventory.

## 3. Inventory

Inventory works end to end: the EU Warehouse imported with 0 errors and the RefArch storefront shows the migrated stock; the US Warehouse imported with 1 error on a test SKU.

### How it works

- **Source:** 3,803 commercetools inventory entries in 6 channels, plus 6 entries without a channel. EU Warehouse (893) and US Warehouse (2,507) are migrated.
- **Output:** one file and one SFCC inventory list per channel (migrated-inventory_<channel>), written to IMPEX src/migration/inventory/ and imported in MERGE mode.
- **Product IDs:** each SKU's commercetools product is looked up (GraphQL, 100 SKUs per call) and turned into the SFCC product ID with the product migration's rules. A SKU with no product is kept as is and counted.
- **Mapping:** quantityOnStock becomes allocation; the export time becomes allocation-timestamp; expectedDelivery and restockableInDays set preorder or backorder with an in-stock date; maxBackorderQuantity becomes preorder-backorder-allocation; other custom fields become custom attributes.
- **On the site:** a site reads exactly one inventory list. RefArch reads migrated-inventory_eu-warehouse-channel.

### Issues fixed

| # | Issue | Fix | Proof |
| --- | --- | --- | --- |
| 1 | Stock never showed: product-id was the commercetools SKU | SKU mapped to the SFCC product ID | Tütchen 40 g, Grußkarte and a bundle show In Stock |
| 2 | Spaces around 3 SKUs broke inventory.xsd | product-id trimmed | All files pass the XSD |
| 3 | Re-imports refused: timestamps were last-change dates up to four years old (48-hour rule) | Export time as timestamp | Re-import into an existing list: 0 errors (a pre-fix file: 871 refused) |
| 4 | A bundle got a test SKU's stock (30,287 instead of 1,635) | Only the master variant's stock goes to a product without variants in SFCC | ATS 1,635 |
| 5 | Backorders had no in-stock date; the backorder limit was a custom attribute | Native in-stock-datetime and preorder-backorder-allocation | In-stock date shows on the storefront |
| 6 | Every export on the same day was named -v001, so an old file was imported by mistake | Existing-file check moved from WebDAV to IMPEX | Unit tests; visible on the next export |

### Test results (1 Oct)

| List | Records | Errors | Warnings | Note |
| --- | --- | --- | --- | --- |
| migrated-inventory_us-warehouse-channel | 2,507 | 1 | 3 | Error: a test SKU stored twice in commercetools |
| migrated-inventory_eu-warehouse-channel | 893 | 0 | 1 | Read by RefArch; storefront and Shop API checks match the file |

All warnings are backorders or preorders without a quantity in commercetools. Records with no SFCC product: EU 119, US 1,047, nearly all SKUs that are on no commercetools product.

### Open items

- Decide which channels to migrate (cs-sales and 3 store channels, 397 entries, are not migrated) and which list each site reads.
- Confirm that products with several commercetools variants take the master variant's stock.
- Decide whether to keep or skip the 1,156 SKUs that are on no commercetools product.
- Decide whether placeholder stock of 1,000,000 or more (EU 29, US 96) means perpetual.
- Import each file within 48 hours of its export.

## 4. Customer

The customer export is valid and 102,968 of 103,377 customers imported; the 396 skipped customers have the same login in the EU and the US store, which separate customer lists resolve.

### How it works

1. **Export:** the console writes one series of files per commercetools store (eu-store, us-store, no store), about 20,000 customers per file, to IMPEX src/migration/customer.
2. **Import:** a Business Manager job with the ImportCustomers step (site scope) imports all files of a store in one run, in MERGE mode, into that site's customer list.

Volume: 103,377 customer records (44,138 EU store, 59,222 US store, 17 without a store). A login must be unique within one customer list, and orders only link to customers in the list of the site they are imported into.

### Field mapping (main fields)

| commercetools | customer.xsd | Records with a value |
| --- | --- | --- |
| customerNumber, else the customer ID | customer-no | 103,377 |
| email | login and email | 103,377 |
| (generated) | temporary password, unique per customer | 103,377 |
| firstName, lastName | first-name, last-name | about 103,170 |
| phone | phone-mobile | 65,403 |
| addresses (default = preferred) | addresses | 111,809 on 62,739 customers |
| customerGroup | customer groups | 253 |
| custom fields (siteLanguage, siteCountry, customerType and others) | custom attributes | as present |

The customer number rule is the same one the order migration uses, so orders and customers match.

### Issues and status

| # | Issue | Status |
| --- | --- | --- |
| 1 | EU and US customers in one customer list: 396 skipped ("login is not unique") | Open: one customer list per site |
| 2 | 13 customer numbers appear in both the EU and the US files | Open: resolved by separate lists |
| 3 | Orders referenced customers by commercetools ID while customers used customerNumber (56,051 orders affected) | Fixed in the order migration |
| 4 | Temporary passwords are in plain text in the import files | Decision: delete files after import; plan a password-reset message |
| 5 | One customer referenced by an order is not in the export (order 1046000571) | Open: check in commercetools |
| 6 | Site Import rejected the downloaded zip | Not a bug: use the ImportCustomers job |

### Test results

- customer.xsd validation of all 7 files: valid.
- Import job (30 Sep, 9 minutes): 103,377 processed, 102,968 created, 396 skipped, 0 other errors.
- Orders whose customer exists: 203 of 203 (v003) and 495 of 499 (v005); the misses are skipped duplicates and the one missing customer.

### Open items

- Decide the site setup (separate EU and US sites with their own customer lists, or one shared list), then create and assign the lists.
- If one shared list is chosen: a rule to merge the 396 duplicate customers.
- Password handling and deleting the import files after the import.
- Reconcile the customer total with commercetools.

## 5. Order

The order export is complete: all 102,578 commercetools orders export into files valid against order.xsd, and test imports link orders to their customers and products.

### How it works

1. **Filter and count:** date range (1, 2, 3 years or all orders), optional order and payment state, optional maximum count. The count is exact beyond commercetools' 10,000 limit.
2. **Fetch:** orders are read oldest first in pages of 20 with a cursor, so there is no offset limit; payments, workflow state and channels are expanded, and customer numbers are read per page.
3. **Map and resolve:** each order is mapped to order.xsd; each line item gets its SFCC product ID {master}-{n}; the customer is linked by customer number.
4. **Write:** 1,000 orders per request; a new file starts before a file passes 190 MB, giving about 5 files for all orders.
5. **Import:** Merchant Tools > Ordering > Import & Export. An existing order number is skipped, and a registered order is rejected when its customer is not in the site's customer list, so customers are imported first.

### Field mapping

order.xsd decides where each value goes: the native element when one exists, custom attributes only when the XSD has none.

| Native order.xsd elements | Custom attributes |
| --- | --- |
| Order number, dates, currency, locale, customer number and email, addresses, shipping method | Order custom fields, plus store, completedAt, anonymousId, customerGroup, country and discount codes (Order) |
| Product line items with price, tax and tax rate; line, shipping and order discounts as price adjustments | Line item custom fields and supply/distribution channel (ProductLineItem) |
| Custom line items: credits as adjustments, shipping charges as shipping line items, others as product line items | Address custom fields such as VAT, EORI and pickup point, plus address email (OrderAddress) |
| Payment method, amount, processor, transaction ID and type; tracking numbers; workflow state as external-order-status | Payment custom fields such as card last 4 and holder (OrderPaymentInstrument); credit custom fields (PriceAdjustment) |

### Issues fixed

| Area | Fix |
| --- | --- |
| Volume | No 50,000-order or 10,000-offset limit: batched export, cursor paging, files up to 190 MB, exact count |
| Links | Customer number from the customer record; product ID {master}-{n} from product and variant |
| Amounts | Line totals instead of unit prices; custom line items and all discounts kept; external tax spread over the lines; real tax rate and taxation flag |
| Payments and shipping | Real payment method, processor and transaction; tracking numbers |
| Custom data | Line item, address, payment and order extras kept as custom attributes; set and money values written correctly |
| Attribute setup | Check Attributes covers Order, ProductLineItem, OrderAddress, OrderPaymentInstrument and PriceAdjustment; it now also offers the six extra order fields, and line-item attributes such as pdpUrl are created without the localizable flag SFCC rejects |

### Test results

| Test | Orders | Result |
| --- | --- | --- |
| Full export, all dates | 102,578 | 5 files, every order once, same sequence as commercetools |
| Offline mapping: newest and oldest 500 orders | 1,000 | 0 errors, all valid; all 39 orders with custom line items match |
| Live: newest, oldest and random orders | 65 | All valid; real payment methods |
| Sandbox import v005, new code | 515 | 511 imported, 4 rejected (customer missing); tracking on 489 of 489 shipped orders; 745 of 774 lines linked to a product |
| Sandbox import v001, old code | 24,849 | 24,770 imported, 79 rejected |

Totals differ from commercetools only where commercetools' own data is inconsistent: legacy orders whose stored total does not equal their lines (about a third of sampled older orders), deleted products, and one tax rounding case.

### Open items

| Item | Blocks the final import |
| --- | --- |
| Run Check Attributes on the order page and create the 7 listed attributes | Yes |
| Separate EU and US customer lists | Yes |
| Store filter on the order export, if EU and US become two sites | Yes |
| Sandbox reset before the final import | Yes |
| Payment methods: create the 7 Adyen methods in SFCC or map them to existing ones | No (warnings only) |
| Legacy orders with inconsistent totals: add a difference adjustment or import as they are | No |
| Production robustness for about 1M orders: resume after failure, optional compression | No, but before production |
| Automatic order import (SFCC has no standard job step for orders) | No |

## Decisions across modules

One decision drives most of the remaining work: whether EU and US run as separate SFCC sites.

| Decision | Modules affected | Options |
| --- | --- | --- |
| EU and US as separate sites | Customer, order, inventory, price book | Two sites, each with its own customer list, inventory list and price books (needs the order store filter); or one site with shared lists (then the 396 duplicate customers must be merged) |
| Currency per site and EUR by country | Price book | Which currencies each site sells in; one EUR price book, or one per country site |
| Channels | Inventory, price book | Store channels and cs-sales: migrate as store inventory, or skip; channel price books: skip, or map to sites |
| Products with several commercetools variants but one SFCC product | Product, price book, inventory | Use the master variant's price and stock (current rule), and decide whether sizes such as 2lb/5lb/10lb should become separate products |
| Inventory data without a product | Inventory | Keep or skip the 1,156 SKUs on no commercetools product; treat placeholder stock of 1,000,000 or more as perpetual or not |
| Order details | Order | Create the Adyen payment methods or map them; adjust legacy totals or import them as they are |
| Customer passwords | Customer | Password-reset message to customers; delete the import files after import |

## Sandbox-only configuration

These settings were made by hand on sandbox zzkc-009 for testing; none of them is in a code repository, so production needs each one set up again.

| Setting | Where | Production |
| --- | --- | --- |
| Storefront base cartridge (app_storefront_base and modules) copied into code version ct-migration-consoile-product | Code version on the sandbox | Deploy the full storefront cartridge path |
| Locale de_CH enabled for RefArch | Business Manager: global and site locales | Enable the locales each site sells in |
| Country de_CH with currency CHF added to countries.json | app_storefront_base on the sandbox only | Add to the storefront repository if CHF is sold |
| CHF allowed on RefArch | Merchant Tools > Site Preferences > Currencies | Allow each site's currencies |
| Price book product-list-prices-chf assigned to RefArch | Price book site assignment | Assign each price book to its site |
| Inventory list migrated-inventory_eu-warehouse-channel assigned to RefArch | Site inventory list | Assign each list to its site |
| Product and order attributes created with the pre-flight and Check Attributes steps | System object definitions | Run both checks on every new instance |
| Customer import job ImportMigrationCustomers | Administration > Operations > Jobs | Create the job per site |
| Shop API read access to products and prices | OCAPI settings | For verification only |

Test data to clean up on the sandbox: 893 test records in inventory list inventory_m, and old import files in IMPEX.

## Final run plan

Run the modules in this order on a reset sandbox or on production, each after the modules it depends on.

1. **Prepare the instance:** site setup decided; locales and currencies allowed; storefront code deployed; customer lists and inventory lists created and assigned to their sites.
2. **Catalog:** run the pre-flight attribute check, export the products, import them. Check: 0 errors.
3. **Price books:** once the bundle rows are fixed in the price book PR, generate all currencies, import with REPLACE and assign each price book to its site. Check: every product-id exists in the catalog.
4. **Inventory:** export each channel and import it within 48 hours in MERGE mode. Check: 0 errors, and each list assigned to its site.
5. **Customers:** export, then run the ImportCustomers job per store into that site's customer list. Delete the files after the import.
6. **Orders:** run Check Attributes and create the attributes, export per site, then import in Merchant Tools > Ordering > Import & Export. Check: rejections only for known missing customers.
7. **Verify:** sample products, prices and stock on the storefront and in the Shop API; check customer accounts and their orders in Business Manager.

After every import, read the import log: the expected warnings are listed in each module's section above. Export inventory and orders as close to cutover as possible, because both keep changing in commercetools.

## Code and branch status

Product work is merged, the order PR and the price book PR are in review, and the inventory changes wait for the order PR.

| Module | Where the code is | Status |
| --- | --- | --- |
| Product and catalog | PR #31 and PR #32, merged into development | Merged; a small test follow-up is part of the order PR |
| Price book | Price book PR | In review; the 48 bundle rows still need to be fixed there |
| Inventory | Working copy, deployed on the sandbox | Goes into its own branch and PR once the order PR is merged |
| Customer | Customer migration module | Complete; no open code changes |
| Order | feature/ct-order-migration | PR in review |

- **Tests:** the bm_accelerator unit suite passes (299 tests), including new tests for every change.
- **Other platforms:** Shopify and BigCommerce output is unchanged; tests cover the shared code paths.
- **Sandbox code version:** ct-migration-consoile-product on zzkc-009 runs the product, inventory and order code above.
