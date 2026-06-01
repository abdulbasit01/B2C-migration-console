# B2C Migration Console — Developer Guide

## What This Project Does

This project is a **Salesforce Commerce Cloud (SFCC) B2C storefront** with a built-in **Migration Console** inside Business Manager (BM). The Migration Console lets you migrate data from **Commercetools (CTP)** directly into SFCC — products, categories, customers, and inventory — without any separate tools or servers.

---

## Project Structure

```
B2C-migration-console/
│
├── cartridges/
│   ├── app_storefront_base/          # Core SFCC storefront (do not edit)
│   ├── app_storefront_custom/        # Your custom storefront overrides
│   ├── app_custom_headless/          # Headless API + Page Designer components
│   ├── bm_app_storefront_base/       # Business Manager UI extensions
│   ├── modules/                      # Shared SFCC server-side modules
│   │
│   └── bm_accelerator/               # ← MIGRATION CONSOLE (main cartridge)
│       └── cartridge/
│           ├── controllers/
│           │   └── Accelerator.js    # Wizard routes + migration logic entry point
│           │
│           ├── scripts/
│           │   ├── accelerator/
│           │   │   └── migrationData.js   # Wizard UI data (steps, platforms, field labels)
│           │   │
│           │   └── migration/             # ← MIGRATION ENGINE
│           │       ├── config.js          # CTP + SFCC credentials and settings
│           │       ├── ctpClient.js       # All Commercetools API calls
│           │       ├── sfccClient.js      # All SFCC OCAPI calls
│           │       ├── transformers.js    # Convert CTP data format → SFCC format
│           │       └── runner.js          # Runs the migration end-to-end
│           │
│           └── templates/
│               └── default/accelerator/
│                   ├── dashboard.isml     # Platform selection screen
│                   ├── wizard.isml        # Wizard shell (header + footer nav)
│                   └── components/
│                       ├── stepConnect.isml   # Step 1: Enter credentials
│                       ├── stepFetch.isml     # Step 2: Live entity counts
│                       ├── stepAiMap.isml     # Step 3: Field mapping review
│                       ├── stepMove.isml      # Step 4: Run migration progress
│                       └── stepView.isml      # Step 5: Results summary
│
├── package.json     # SFCC build tools (webpack, sgmf-scripts, eslint, etc.)
└── MIGRATION.md     # This file
```

---

## How the Migration Works

There is **no separate server** and **nothing to start**. When the BM user clicks through the wizard, the SFCC controller runs the migration directly using SFCC's built-in `dw.net.HTTPClient` to talk to both APIs.

```
Business Manager (browser)
        │
        ▼
Accelerator.js controller  ← runs on SFCC cloud server
        │
        ├──► ctpClient.js  ──► Commercetools REST API
        │         (fetch products, categories, customers, inventory)
        │
        ├──► transformers.js
        │         (convert CTP data shape → SFCC data shape)
        │
        └──► sfccClient.js ──► SFCC OCAPI Data API v25_6
                  (upsert products, categories, customers, inventory)
```

---

## The 5-Step Wizard

| Step | Screen | What Happens |
|------|--------|-------------|
| 1 | **Connect** | Shows your CTP credentials (pre-filled). User verifies they are correct. |
| 2 | **Fetch** | Controller calls CTP API and shows **live counts**: Products (730), Categories (195), etc. |
| 3 | **AI Map** | Shows the field mapping from CTP fields to SFCC fields with confidence scores. |
| 4 | **Move** | Controller **runs the full migration**. Fetches all CTP data → transforms it → loads into SFCC via OCAPI. Shows progress phases when done. |
| 5 | **View** | Shows the final results: how many records were imported successfully and how many failed. |

---

## Migration Engine Files Explained

### `config.js` — Credentials & Settings
Holds all connection credentials. **This file is in `.gitignore` — never commit it.**

```
CTP settings:  project key, client ID/secret, API URL
SFCC settings: sandbox URL, BM username/password, catalog ID
Migration:     batch size, dry run toggle
```

### `ctpClient.js` — Commercetools API
- Gets an OAuth2 token from CTP using `client_credentials` grant
- Fetches paginated data from any CTP endpoint (`/products`, `/categories`, `/customers`, `/inventory`)
- `getEntityCounts()` — gets total record counts (used in Step 2)
- `fetchAll()` — fetches all pages of records (used in Step 4)

### `sfccClient.js` — SFCC OCAPI
- Gets a BM User Grant token (3-part base64 credential: `username:password:clientId`)
- `ensureAttributes()` — checks if custom attributes exist in SFCC; creates any that are missing
- `upsertProduct()` — PUT to `/s/-/dw/data/v25_6/products/{id}`
- `upsertCategory()` — PUT to `/s/-/dw/data/v25_6/catalogs/{id}/categories/{id}`
- `upsertCustomer()` — searches by email, then PATCH (update) or POST (create new)
- `upsertInventory()` — PUT to inventory list records

### `transformers.js` — Data Conversion
Converts CTP data format to the shape SFCC expects:

| CTP field | SFCC field |
|-----------|------------|
| `product.key` | `Product.id` |
| `masterData.current.name` (localized object) | `Product.name.default` (string) |
| `masterVariant.attributes[]` | `Product.c_attributeName` (custom attributes) |
| `category.key` | `Category.id` |
| `customer.email` | `Profile.email` |
| `inventory.sku` | `InventoryRecord.product_id` |

CTP uses localized objects like `{ "en": "Blue Shirt", "en-US": "Blue Shirt" }`. The transformer picks the English value.

CTP custom attributes like `[{ name: "color", value: "blue" }]` become SFCC custom attributes `c_color = "blue"`.

### `runner.js` — Orchestration
Runs all four migration tasks in order:
1. `migrateCategories()` — fetch all CTP categories → transform → upsert to SFCC
2. `migrateProducts()` — fetch all CTP products → transform → ensure attributes exist → upsert to SFCC
3. `migrateCustomers()` — fetch all CTP customers → transform → upsert to SFCC
4. `migrateInventory()` — fetch all CTP inventory → transform → upsert to SFCC

Returns `{ categories: { success: 195, failed: 0 }, products: { success: 730, failed: 2 }, ... }`

### `Accelerator.js` — Controller (Entry Point)
Handles two BM URL routes:
- `Accelerator-Start` → renders the dashboard (platform selection)
- `Accelerator-Wizard?platform=commercetools&step=N` → renders each wizard step

On each step it enriches the template data:
- Step 2: calls `ctpClient.getEntityCounts()` → real numbers in Fetch screen
- Step 4: calls `runner.runAll()` → stores results in BM session
- Step 5: reads results from BM session → shows in View screen

---

## Setup

### 1. Configure Credentials
Edit `cartridges/bm_accelerator/cartridge/scripts/migration/config.js`:

```js
ctp: {
    projectKey: 'your-ctp-project-key',
    clientId:   'your-client-id',
    clientSecret: 'your-client-secret',
    authUrl:    'https://auth.us-central1.gcp.commercetools.com',
    apiUrl:     'https://api.us-central1.gcp.commercetools.com',
    scopes:     'manage_project:your-ctp-project-key'
},
sfcc: {
    baseUrl:    'https://your-instance.dx.commercecloud.salesforce.com',
    bmUsername: 'your-bm-username@company.com',
    bmPassword: 'your-bm-password',
    catalogId:  'your-catalog-id'
}
```

### 2. Install & Build
```bash
npm install
npm run build
```

### 3. Upload Cartridges to SFCC Sandbox
Create `dw.json` in the project root (never commit this file):
```json
{
  "hostname": "your-instance.dx.commercecloud.salesforce.com",
  "username": "your-bm-username@company.com",
  "password": "your-bm-password",
  "code-version": "version1"
}
```

Then upload:
```bash
npm run uploadCartridge
```

For `bm_accelerator` specifically:
```bash
npx sgmf-scripts --uploadCartridge bm_accelerator
```

### 4. Enable in Business Manager
1. Go to **BM → Administration → Sites → Manage Sites → Select your site → Settings**
2. Add `bm_accelerator` to the **Cartridge Path** (before other cartridges)
3. Go to **BM → Administration → Migration Console** — the wizard will appear

---

## SFCC OCAPI Configuration

The migration uses OCAPI Data API. Make sure your SFCC sandbox has these OCAPI permissions configured:

Go to **BM → Administration → Site Development → Open Commerce API Settings → Data**

```json
{
  "client_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "resources": [
    { "resource_id": "/products/**", "methods": ["get","put","patch"], "read_attributes": "(**)", "write_attributes": "(**)" },
    { "resource_id": "/catalogs/**", "methods": ["get","put","patch"], "read_attributes": "(**)", "write_attributes": "(**)" },
    { "resource_id": "/customers/**", "methods": ["get","put","patch","post"], "read_attributes": "(**)", "write_attributes": "(**)" },
    { "resource_id": "/inventory_lists/**", "methods": ["get","put","patch"], "read_attributes": "(**)", "write_attributes": "(**)" },
    { "resource_id": "/system_object_definitions/**", "methods": ["get","put"], "read_attributes": "(**)", "write_attributes": "(**)" },
    { "resource_id": "/customer_search", "methods": ["post"], "read_attributes": "(**)", "write_attributes": "(**)" }
  ]
}
```

---

## Important Notes

**Custom Attributes:** CTP products often have custom fields that don't exist in SFCC by default. The migration automatically creates these as SFCC custom attributes before importing the data. No manual Business Manager setup needed.

**Large Datasets:** SFCC controller requests have a timeout (~60 seconds). For very large catalogs (10,000+ products), the Step 4 migration may time out. In that case, split the migration into smaller runs using the CTP filter by product key, or migrate one entity type at a time.

**Dry Run:** To test the migration without writing any data, set `dryRun: true` in `config.js`. The wizard will show what would have been imported without actually sending data to SFCC.

**Re-running:** The migration is safe to re-run. Products and categories use PUT (upsert), so running twice updates existing records rather than creating duplicates. Customers are matched by email.
