# User Guide — B2C Migration Console

## Overview

The console migrates schema (custom attributes) and data (orders, customers, products, inventory, price books, tax, stores, shipping methods, categories) from **commercetools** or **Shopify** into Salesforce B2C Commerce via IMPEX XML and OCAPI.

## Entry points

| Menu | Purpose |
|------|---------|
| B2C Migration → Start Migration Wizard | Dashboard, schema wizard, data wizard |
| B2C Migration → Product Catalog Wizard | Product-focused flow |
| Site Preferences → B2C Migration Console | Merchant configuration (credentials) |

## Schema wizard

1. Connect to the source platform
2. Fetch object type definitions / metafields
3. Map and select attributes
4. Create missing SFCC custom attributes (OCAPI)
5. Review results

## Data wizard

1. Connect
2. Select data type (order, customer, product, inventory, …)
3. Configure filters (years, max counts, catalogs, etc.)
4. Run export / batch build → IMPEX under `IMPEX/src/migration/...`
5. Import XML via BM Import & Export or configured jobs

## Customer passwords

Migrated customers receive a **random temporary password**. Merchants should require a password reset (or use passwordless/login migration strategy) before go-live. Temporary passwords are not derived from source IDs.

## Logging

Server logs use category prefix `bm_accelerator` (e.g. `Shopify`, `CTP`, `SFCC`, `Security`). Service Framework communication logs redact tokens and secrets.

## Support

Contact Royal Cyber for LINK support. Include cartridge version from `bm_accelerator.properties` and relevant log excerpts (never include access tokens).
