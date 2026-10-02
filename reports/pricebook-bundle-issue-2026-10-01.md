# Price book: bundle prices do not reach SFCC bundles

Last updated: 1 Oct 2026

| Property | Value |
| --- | --- |
| Status | Open, to be fixed in the price book PR |
| Scope | commercetools embedded prices to SFCC price books (bm_accelerator, commercetools path only) |
| Not affected | Shopify, BigCommerce and SAP price books; commercetools variant prices |
| Sandbox | zzkc-009, site RefArch, price book product-list-prices-chf |

## Summary

Every bundle price is written under an SFCC product ID that does not exist, so no bundle has a price in SFCC.

- **CHF:** 48 of the 271 rows in the CHF price book are affected. They belong to 47 bundles, and none of these bundles shows a price on the storefront.
- **Other currencies:** the same problem will appear in EUR, USD, GBP, DKK and PLN when they are generated (see [Numbers by currency](#numbers-by-currency)).
- **Fix:** write a bundle's price under its plain product ID, using only the master variant's price.

## The ID rule the price book must follow

The product migration decides the SFCC product IDs, so the price book must use the same ones.

| commercetools product | SFCC catalog | price-table product-id |
| --- | --- | --- |
| Normal product (product type is not a bundle or set) | Variation master `{productId}` with variants `{productId}-{n}`, where n is the position (master variant = 1, then 2, 3, …) | `{productId}-{n}`: already correct |
| Bundle (product type name contains "bundle") | One bundle product `{productId}`, built from the master variant, with no variant products | `{productId}`, master variant's price only |
| Set (product type name contains "set") | One product set `{productId}`, no variants | `{productId}` (there are no sets in the current data) |

Where this is defined in the code:

- `productMigration/productTransformer.js`
  - `detectProductKind`, line 28, decides bundle, set or base from the product type.
  - Variant IDs are set at line 832.
- `productMigration/productXmlBuilder.js`
  - Only a base product with variants gets variant products (line 1075).
  - Bundles and sets carry their master variant's SKU (line 1024).

## Evidence

The CHF file `pricebook-emb_agg_chf-20260930-v002.xml` was imported on 1 Oct with 0 errors. It was checked against two sources:

- the imported catalog `ctp_product-20260929-v002-p0001.xml`
- commercetools product data from 29 Sep

| Check | Result |
| --- | --- |
| Rows in the CHF file | 271 |
| Rows whose product-id exists in the catalog | 223, all variants; their amounts match commercetools |
| Rows whose product-id does not exist | 48, all of the form `{bundleId}-{n}` |
| Bundles behind those 48 rows | 47 (one bundle has two rows) |
| Catalog bundles priced under their own ID | 0 of 75 |
| Storefront (de_CH) | The bundles exist and show no price; `{bundleId}-1` is not a product |

The import reports no error because SFCC accepts a price table for a product ID that is not in the catalog. The 48 rows are stored in the price book, but no product uses them.

Examples:

| Bundle | Row written today | Correct row | CHF price |
| --- | --- | --- | --- |
| Surprise Gift Box 400 g + M&M'S Orange XL Mug | `ecbfea07-e6c9-4d49-9496-8abd6c6eb568-1` | `ecbfea07-e6c9-4d49-9496-8abd6c6eb568` | 46.00 |
| 1.5 kg bulk bag PEANUT + 30 DIY balls to fill | `3f034bb5-7080-411a-bc7c-e1c638beb404-1` | `3f034bb5-7080-411a-bc7c-e1c638beb404` | 100.00, with tiers for 2, 3, 5, 10 and 20 |
| 1.5 kg Bulk Bag + 30 Cubes To Fill | `41cbb1eb-9041-48dd-b158-f5cf4d0ecb35-1` (120.00) and `-2` (150.00) | `41cbb1eb-9041-48dd-b158-f5cf4d0ecb35`, from the master variant only | 120.00, with tiers for 2 and 3 |

## Root cause

The price book applies the variant naming `{productId}-{n}` to every commercetools variant without checking the product kind. That naming is right for normal products. The product migration does not create variant products for bundles and sets, though: SFCC holds each one as a single product under the plain product ID.

## Fix in the price book PR

Make the change where the price book builds `{productId}-{n}` for each variant. In the current code that loop is `extractRecordsFromProduct` in `pricebookMigration/embeddedPriceExtractor.js`.

1. **Product kind:** decide it exactly as the product migration does, with `productTransformer.detectProductKind(ctpProduct, data)`.
   - It is not exported today, so add it to `module.exports` in `productTransformer.js`. This is a one-line change and changes no behavior.
   - The product fetcher that the price book uses already expands `productType`, which this check reads.
2. **Bundle or set:** write one record whose product-id is the plain product ID: the same master ID used today, without `-n`. Take the master variant's prices and skip the other variants.
3. **Any other product:** keep `{productId}-{n}` as today.

```js
var productTransformer = require('*/cartridge/scripts/migration/productMigration/productTransformer');

// SFCC holds a bundle or set as one product under the plain product ID, built from the
// master variant (no variant products), so only the master variant's price belongs to it.
var kind = productTransformer.detectProductKind(ctpProduct, data);
var plainProduct = kind === 'bundle' || kind === 'set';

// for each variant at position n (1 = master variant):
if (plainProduct && n !== 1) continue;
record.productId = plainProduct ? masterId : masterId + '-' + n;
```

**Why only the master variant:** the bundle `41cbb1eb…` also has a test variant (SKU `9139test`) priced at CHF 150.00, next to the real CHF 120.00. If both rows were renamed to the plain ID, the second would overwrite the first. No bundle has a price only on a non-master variant, so this rule loses no price. The inventory migration uses the same rule for bundle stock.

The order migration resolves products through `orders/productIdResolver.js`, which follows the same ID rule. That file reaches the shared code when the order PR is merged.

## Clean-up on the sandbox

The 48 rows with `-n` IDs are already in `product-list-prices-chf` from the 1 Oct import. Import the regenerated CHF file in **REPLACE** mode: it replaces the whole price book with the file, so the 48 rows are removed. A MERGE import would leave them in place.

## Acceptance checks

1. **Unit tests to add in the PR:**
   - A bundle with one variant gives one row under the plain ID.
   - A bundle with two variants at different prices gives one row with the master variant's price, and no `-2` row.
   - A bundle with tier prices keeps its tiers on the plain-ID row.
   - A normal product with variants, including a gap in its variant IDs, still gives `{productId}-{position}`.
   - Shopify, BigCommerce and SAP output is unchanged.
2. **Regenerate the CHF file:** expect 270 rows (223 variants and 47 bundles), every product-id in the catalog, and no bundle row ending in `-n`.
3. **Import with REPLACE:** expect 0 errors.
4. **Storefront (de_CH):**
   - Surprise Gift Box 400 g + M&M'S Orange XL Mug shows CHF 46.00.
   - 1.5 kg bulk bag PEANUT + 30 DIY balls to fill shows CHF 100.00 and its tiers.
   - 1.5 kg Bulk Bag + 30 Cubes To Fill shows CHF 120.00.
5. **Other currencies:** check that every product-id exists in the catalog, and compare the bundle row counts with the table below.

## Numbers by currency

| Currency | Bundle rows today (wrong ID) | Bundle rows after the fix |
| --- | --- | --- |
| CHF | 48 | 47 |
| EUR | 66 | 63 |
| DKK | 54 | 53 |
| PLN | 50 | 49 |
| GBP | 42 | 41 |
| USD | 31 | 27 |

CHF was measured on the generated file. The other currencies have no files yet, so their counts are estimated from commercetools data of 29 Sep.

The catalog holds 83 commercetools bundles, all under their plain product ID:

- **75 with bundle members.** These are the bundles behind the CHF rows.
- **8 without members, imported as standard products.** They have prices only in other currencies.

The fix above covers both groups.
