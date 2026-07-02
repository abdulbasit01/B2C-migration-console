# Product Data Migration — Commercetools → SFCC
## End-to-End Analysis, Challenges, Risks & Recommended Solutions

---

## 1. Executive Summary

This document covers the complete analysis for migrating **product catalog data** from Commercetools (CTP) to Salesforce Commerce Cloud (SFCC). The migration scope is strictly limited to product data — specifically products, product variants, product types (attribute definitions), categories, and localised content. Pricing, inventory, promotions, and orders are out of scope for this migration phase.

The migration uses a **Product ID–based mapping** strategy: the CTP product `key` (or slug) is used as the SFCC product ID, providing a simple, deterministic, one-to-one identity link between systems.

---

## 2. Scope

### In Scope
| CTP Entity | SFCC Target | Notes |
|---|---|---|
| Products (`/products`) | Products in catalog XML | Master products with variants |
| Product Variants | Product variations (SKUs) | Mapped via variant attributes |
| Product Types | Custom attribute definitions | Via Schema Migration wizard (prerequisite) |
| Product Localizations | Localized product names/descriptions | All CTP locales → SFCC locales |
| Categories (`/categories`) | Categories in catalog XML | Tree structure preserved |
| Category Assignments | Product → category assignments | |
| Product Images | Image references in catalog XML | URLs referenced, not binary-transferred |

### Out of Scope
| Entity | Reason |
|---|---|
| Prices / Pricebooks | Separate pricing migration phase |
| Inventory / Stock | Separate inventory migration phase |
| Promotions / Discounts | Separate promotions migration phase |
| Orders | Separate order migration phase |
| Customers | Already handled by Customer Migration module |
| Product Search Keywords | SFCC SEO setup is post-migration |
| Product Recommendations | Platform-specific, not portable |

---

## 3. Source System — Commercetools Product Model

### 3.1 Product Structure in CTP

```
Product
├── id (UUID)                     — Internal CTP ID
├── key (string)                  — Human-readable, unique identifier
├── productType (reference)       — Defines custom attributes
├── masterData
│   ├── current / staged
│   │   ├── name (LocalizedString)
│   │   ├── description (LocalizedString)
│   │   ├── slug (LocalizedString)
│   │   ├── categories (array of refs)
│   │   ├── masterVariant
│   │   │   ├── id (int, always 1)
│   │   │   ├── sku (string)
│   │   │   ├── attributes (array)
│   │   │   └── images (array of {url, label, dimensions})
│   │   └── variants (array of Variant)
│   │       ├── id (int, 2, 3, ...)
│   │       ├── sku
│   │       ├── attributes
│   │       └── images
└── taxCategory, state, reviewRatingStatistics (not in scope)
```

### 3.2 CTP Attribute Types
| CTP Type | Description |
|---|---|
| `text` | Single locale string |
| `ltext` | Localized text (multiple locales) |
| `number` | Decimal number |
| `integer` | Whole number |
| `money` | Amount + currency (NOT in scope) |
| `boolean` | True/False |
| `date`, `time`, `datetime` | Date/time values |
| `enum` / `lenum` | Enumeration (key + label) |
| `reference` | Reference to another CTP resource |
| `nested` | Nested object (product type ref) |
| `set` | Collection of any of the above |

---

## 4. Target System — SFCC Product Model

### 4.1 SFCC Product Structure

```
Product (catalog XML)
├── product-id                    — Primary identifier (string, max 100 chars)
├── display-name (locale)         — Localised product name
├── short-description (locale)    — Localised short description
├── long-description (locale)     — Localised long description
├── online-flag                   — Whether product is published
├── searchable-flag               — Whether product appears in search
├── available-flag                — Whether product can be purchased
├── classification-catalog        — Reference to attribute-defining catalog
├── custom-attributes             — Custom attribute values
├── variations
│   ├── attributes (variation dimensions, e.g. color, size)
│   └── variants
│       ├── product-id            — SKU identifier
│       ├── custom-attributes
│       └── variation-values      — e.g. color=red, size=M
├── product-set-products (if applicable)
└── images
    └── image path references
```

### 4.2 SFCC Catalog XML Files
SFCC uses a **catalog import XML** format (`catalog.xml`) structured as:
```xml
<catalog xmlns="...">
  <header catalog-id="storefront-catalog-en">...</header>
  <category>...</category>             <!-- category definitions -->
  <category-assignment>...</category-assignment>
  <product>
    <product-id>ctp-key-here</product-id>
    <display-name xml:lang="en">...</display-name>
    <variations>
      <attributes>
        <variation-attribute attribute-id="color" variation-attribute-id="color">
          <variation-attribute-values>
            <variation-attribute-value value="red">...</variation-attribute-value>
          </variation-attribute-values>
        </variation-attribute>
      </attributes>
      <variants>
        <variant product-id="sku-123" default="true"/>
      </variants>
    </variations>
    <custom-attributes>...</custom-attributes>
  </product>
  <product product-id="sku-123">       <!-- variant as standalone product -->
    ...
    <variation-values>
      <variation-value attribute-id="color" value="red"/>
    </variation-values>
  </product>
</catalog>
```

---

## 5. Product ID Mapping Strategy

### 5.1 Approach — CTP Key → SFCC Product ID

| CTP Field | SFCC Field | Notes |
|---|---|---|
| `product.key` | `product-id` | Preferred — human-readable, stable |
| `product.masterData.current.slug['en']` | `product-id` fallback | If key is null |
| `product.id` (UUID) | Last fallback | Guaranteed unique, but not human-readable |

**Decision rule (priority order):**
1. Use `product.key` if present and non-empty
2. Use English slug (`slug.en`) if key is absent
3. Use CTP `product.id` (UUID) as last resort

### 5.2 Variant ID Mapping

| CTP Field | SFCC Field | Notes |
|---|---|---|
| `variant.sku` | `product-id` (variant) | Preferred — SKU is the commerce identifier |
| `{product-key}-{variant.id}` | `product-id` fallback | If SKU is absent |

### 5.3 Category ID Mapping

| CTP Field | SFCC Field | Notes |
|---|---|---|
| `category.key` | `category-id` | Preferred |
| `category.id` (UUID) | `category-id` fallback | If key absent |

---

## 6. Data Mapping — Field by Field

### 6.1 Core Product Fields

| CTP Field | SFCC XML Element | Type | Notes |
|---|---|---|---|
| `product.key` | `product-id` | string | See ID mapping above |
| `masterData.current.name` | `display-name` | LocalizedString | All locales |
| `masterData.current.description` | `long-description` | LocalizedString | All locales |
| `masterData.current.slug` | N/A (used as fallback ID only) | — | SFCC uses URL rules |
| `masterData.current.masterVariant.sku` | Master variant product-id | string | |
| `masterData.publishedAt` | `online-flag` | boolean | published = true |

### 6.2 Variant Fields

| CTP Field | SFCC XML Element | Notes |
|---|---|---|
| `variant.sku` | `product-id` | Variant identifier |
| `variant.attributes` | `custom-attributes` | Per attribute type mapping |
| `variant.images[0].url` | `image` path | First image as main image |
| `variant.images[*]` | Additional images | All images included |

### 6.3 Attribute Type Mapping

| CTP Attribute Type | SFCC Custom Attribute Type | Notes |
|---|---|---|
| `text` | `string` | Direct |
| `ltext` | `string` (per locale) | One element per locale |
| `number` | `double` | |
| `integer` | `int` | |
| `boolean` | `boolean` | |
| `date` | `date` | ISO format: `YYYY-MM-DD` |
| `datetime` | `datetime` | ISO 8601 |
| `enum.key` | `string` | Key value used |
| `lenum.key` | `string` | Key value used |
| `money` | **OUT OF SCOPE** | Handled in pricing phase |
| `reference` | `string` (ID only) | Reference target not migrated |
| `set of text` | `set-of-string` | |
| `nested` | `string` (JSON serialized) | Complex nested → string fallback |

---

## 7. Migration Considerations

### 7.1 Published vs Staged Data
- CTP products have `masterData.current` (published) and `masterData.staged` (draft)
- **Recommendation:** Migrate from `masterData.current` only (published data)
- Staged/draft products are not migrated in this phase

### 7.2 Product Type Prerequisites
- CTP product types define custom attributes. These custom attributes must exist in SFCC before product import
- **Prerequisite:** Run the **Schema Migration wizard** first to create SFCC custom attribute definitions from CTP product types
- If a CTP attribute has no corresponding SFCC definition, its value is silently skipped during import

### 7.3 Localization
- CTP uses a `LocalizedString` map: `{"en": "...", "de": "...", "fr": "..."}`
- SFCC catalog XML uses `xml:lang` attributes: `<display-name xml:lang="en">...</display-name>`
- **All locales present in CTP are included** in the output XML
- Locale code format: CTP uses `en`, `en-US`, `de-DE` — map directly to SFCC `xml:lang` attribute

### 7.4 Categories
- CTP categories have a parent-child tree structure
- SFCC catalog XML defines categories with `parent-category-id`
- **Category tree must be exported before products** so parent categories exist when children reference them
- Category assignments (product → category) are included in the catalog XML

### 7.5 Image Handling
- CTP stores images as external URLs (CDN-hosted)
- SFCC can reference the same URLs — **no binary image transfer required** in this phase
- Image URLs are written into the catalog XML as `<image path="https://..."/>`
- Post-migration: images can optionally be re-hosted on SFCC's Content Delivery Network

### 7.6 Variation Axes (Color, Size, etc.)
- CTP variants are distinguished by attribute values (e.g., `color=red`, `size=M`)
- SFCC requires explicit **variation attribute** declarations on the master product
- The migration must detect which product type attributes serve as variation dimensions
- **Current approach:** Scan all variants of a product, collect attributes that differ between variants — these are the variation axes

### 7.7 Batch Size
- CTP API returns up to 500 products per request (`limit=500`)
- Each batch is written to one XML file and uploaded to WebDAV
- Large catalogs (10,000+ products) will produce 20+ XML files
- Each WebDAV upload and BM import is independent — partial failures don't affect other batches

---

## 8. Challenges & Risks

### 8.1 Product ID Uniqueness
| Risk | Impact | Likelihood |
|---|---|---|
| CTP `product.key` is not set (null) | Medium — fallback to slug/UUID creates non-human-readable IDs | Medium |
| Two CTP products produce the same SFCC product ID | High — import will overwrite or fail | Low (keys are unique in CTP) |
| CTP product key contains characters invalid in SFCC IDs | Medium — import fails for affected products | Low |

**Mitigation:** Sanitize product IDs before writing XML — strip/replace characters outside `[A-Za-z0-9_-]`. Log all sanitizations.

### 8.2 Missing Product Type Attributes
| Risk | Impact | Likelihood |
|---|---|---|
| Custom attributes not yet in SFCC | Attribute values silently dropped during BM import | High (if Schema Migration not run first) |
| Attribute type mismatch (e.g., CTP number vs SFCC string) | BM import error for affected products | Medium |

**Mitigation:** Always run Schema Migration wizard before Product Migration. Document the prerequisite clearly.

### 8.3 Large Catalogs and Timeouts
| Risk | Impact | Likelihood |
|---|---|---|
| CTP API call times out when fetching 500 products | Batch fails, migration stalls | Low-Medium |
| WebDAV upload times out for large XML files | File not uploaded, batch lost | Low |
| BM import job takes hours for large catalogs | Long wait time, unclear progress | Medium |

**Mitigation:** Batching already limits request size. Add retry logic for transient failures. Monitor BM job status via polling.

### 8.4 Variation Structure Differences
| Risk | Impact | Likelihood |
|---|---|---|
| CTP variant attributes not cleanly mapping to SFCC variation axes | Variants imported as standalone products instead of variations | Medium |
| Variant with no distinguishing attribute (same as master) | Invalid SFCC variation structure | Low |
| Product has 50+ variation attributes | SFCC catalog import may reject complex variation structures | Low |

**Mitigation:** Validate variation structure before writing XML. If a product has no meaningful variation axes, import all variants as standalone products.

### 8.5 Category Tree Ordering
| Risk | Impact | Likelihood |
|---|---|---|
| Child category written to XML before parent | BM import fails with "parent not found" | Medium |

**Mitigation:** Sort categories by depth (root first) before writing XML.

### 8.6 Image URLs
| Risk | Impact | Likelihood |
|---|---|---|
| CTP CDN URLs become invalid post-go-live | Product images broken in SFCC | Medium (depends on CTP contract) |
| SFCC content security policy blocks external CDN | Images not displayed | Low |

**Mitigation:** Document that images must be re-hosted on SFCC CDN after initial migration. For go-live, plan a separate image re-hosting step.

### 8.7 Data Volume
| Risk | Impact | Likelihood |
|---|---|---|
| 100,000+ products exceed WebDAV storage quota | Migration cannot complete | Low |
| BM import job for 100,000+ products takes 6–12+ hours | Operational disruption | Medium |

**Mitigation:** Run migration during off-peak hours. Split very large catalogs into subcatalogs per category.

---

## 9. Assumptions

1. **CTP credentials are already saved** from the Schema Migration wizard — no re-authentication step needed
2. **Schema Migration has been completed** — all CTP product type attributes exist as SFCC custom attribute definitions before Product Migration runs
3. **Products are migrated from `masterData.current`** (published/live data only) — staged drafts are not in scope
4. **SFCC catalog ID is known** by the operator — provided as input in the migration UI
5. **CTP image CDN URLs remain accessible** during and after migration — no binary image transfer is performed
6. **Product IDs are stable** — CTP product keys will not change during the migration window
7. **The migration is a one-time operation** per catalog — re-running will overwrite existing products with the same ID (SFCC catalog XML import is upsert-based)
8. **The target SFCC catalog exists** before migration — the catalog ID must be pre-created in BM
9. **WebDAV access is enabled** on the SFCC sandbox/production instance
10. **BM import job (`CTP-Product-Import`) is pre-configured** in the SFCC instance before Phase 2 is triggered

---

## 10. Recommended Approach

### 10.1 Migration Flow

```
[1] Verify Prerequisites
    └─ Schema Migration done?  →  SFCC has product custom attributes?

[2] Count Products
    └─ GET /products?limit=1  →  display total to operator

[3] Phase 1 — Build & Upload Catalog XML (batches of 500)
    ├─ Fetch products (offset=0, 500, 1000, ...)
    ├─ For each batch:
    │   ├─ Build category XML (first batch only)
    │   ├─ Build product XML (master + variants)
    │   ├─ Build category assignment XML
    │   └─ Upload to WebDAV /Impex/src/instance/ctp-product-migration/catalog-{batch}.xml
    └─ Report: N products built, M batches uploaded

[4] Phase 2 — BM Catalog Import Job
    ├─ Trigger job "CTP-Product-Import" via SFCC Job Execution API
    ├─ Poll status every 5 seconds
    └─ Report: imported / failed
```

### 10.2 Catalog XML Generation Rules

| Rule | Detail |
|---|---|
| Product ID | `product.key` → `slug.en` → `product.id` (sanitized) |
| Variant ID | `variant.sku` → `{product-key}-{variant.id}` |
| Category ID | `category.key` → `category.id` |
| Locales | All locales from CTP `LocalizedString` maps |
| Images | All image URLs from `variant.images` |
| Online flag | `true` if product is published, `false` if draft |
| Variation axes | Attributes that differ between variants of the same product |
| Custom attributes | All non-money attributes from all variants |

### 10.3 Handling Edge Cases

| Edge Case | Handling |
|---|---|
| Product with no variants | Export as simple (non-variation) product |
| Product with only one variant | Export as simple product (no variation structure) |
| Variant with no SKU | Generate ID as `{product-key}-v{variantId}` |
| Missing product key | Use `slug.en` → fallback to UUID |
| Attribute value is null | Skip attribute (do not write empty element) |
| Category with no parent | Root category (no `parent-category-id` element) |
| Duplicate category in XML | Write once — track written IDs in a set |

---

## 11. Post-Migration Checklist

- [ ] Verify product count in SFCC BM matches CTP count
- [ ] Spot-check 10–20 products across categories for correct name, description, attributes
- [ ] Check variation structure on at least 5 products with multiple variants
- [ ] Verify product images display correctly (CDN URL still accessible)
- [ ] Verify category tree is intact and product assignments are correct
- [ ] Check localised content for each target locale
- [ ] Confirm no products are in "offline" status unintentionally
- [ ] Run a search query in SFCC storefront to verify searchable products appear

---

## 12. Out of Scope — Separate Migration Phases

| Phase | What | When |
|---|---|---|
| Pricing Migration | Pricebooks, price lists, sale prices from CTP | After product migration |
| Inventory Migration | Stock levels, inventory lists | After product migration |
| Promotions Migration | Cart/product/order discounts | After pricing migration |
| Order Migration | Historical orders | Typically not migrated; new orders start in SFCC |
| Customer Migration | Already complete | Done |
| Image Re-hosting | Move images from CTP CDN to SFCC CDN | Post go-live |
| SEO / URL Redirects | Map CTP slugs to SFCC URLs | Post go-live |
