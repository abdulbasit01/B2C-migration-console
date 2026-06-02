# B2C Migration Console — Developer Guide

## What This Project Does

This project is a **Salesforce Commerce Cloud (SFCC) B2C storefront** with a built-in **Schema Migration Console** inside Business Manager (BM).

**What it migrates:** Schema only — custom attribute definitions (metadata) are created in SFCC to match the field structure in Commercetools. No actual data (products, orders, customers) is moved.

**Why schema migration:** CTP has ProductTypes and Custom Types with fields that do not exist in SFCC by default. Before any data import can happen, SFCC must have matching attribute definitions. This tool creates them automatically.

---

## Project Structure

```
B2C-migration-console/
│
├── cartridges/
│   ├── app_storefront_base/        # Core SFCC storefront (do not edit)
│   ├── app_storefront_custom/      # Your custom storefront overrides
│   ├── app_custom_headless/        # Headless API + Page Designer components
│   ├── bm_app_storefront_base/     # Business Manager UI extensions
│   ├── modules/                    # Shared SFCC server-side modules
│   │
│   └── bm_accelerator/             # ← MIGRATION CONSOLE
│       └── cartridge/
│           ├── controllers/
│           │   └── Accelerator.js         # Wizard routes + schema migration entry point
│           │
│           ├── scripts/
│           │   ├── accelerator/
│           │   │   └── migrationData.js   # Wizard UI: steps, platforms, labels
│           │   │
│           │   └── migration/             # ← SCHEMA MIGRATION ENGINE
│           │       ├── config.js          # Stub in repo; overwritten by config:generate
│           │       ├── config.defaults.js # Safe fallback values (committed)
│           │       ├── sfcc-credentials.js # Stub; overwritten from dw.json
│           │       ├── typeMap.js         # CTP → SFCC type mappings (committed)
│           │       ├── ctpClient.js       # CTP API calls (auth + schema fetch)
│           │       ├── sfccClient.js      # SFCC OCAPI calls (auth + schema create)
│           │       ├── transformers.js    # Convert CTP type defs → SFCC attr defs
│           │       └── runner.js          # Orchestrates all 8 schema groups
│           │
│           └── templates/default/accelerator/
│               ├── dashboard.isml         # Platform selection screen
│               ├── wizard.isml            # Wizard shell
│               └── components/
│                   ├── stepConnect.isml   # Step 1: CTP credentials
│                   ├── stepFetch.isml     # Step 2: Live schema counts
│                   ├── stepAiMap.isml     # Step 3: Type mapping review
│                   ├── stepMove.isml      # Step 4: Schema migration progress
│                   └── stepView.isml      # Step 5: Results summary
│
├── scripts/
│   └── generate-migration-config.js  # dw.json + .env → config.js + sfcc-credentials.js
│
├── dw.json          # SFCC sandbox credentials (gitignored)
├── .env             # CTP credentials (gitignored)
├── .env.example     # Template for .env
├── package.json     # Build + upload scripts
└── MIGRATION.md     # This file
```

---

## API Reference

### Commercetools APIs Used — GET Schema

All CTP calls use **OAuth2 `client_credentials`** grant. Token endpoint:

```
POST {CTP_AUTH_URL}/oauth/token
Authorization: Basic base64(clientId:clientSecret)
Body: grant_type=client_credentials&scope={scopes}
```

| Purpose | Method | CTP Endpoint | Response fields used |
|---------|--------|-------------|----------------------|
| **Verify connection** | `GET` | `/{projectKey}` | `key`, `name` |
| **Get schema counts** | `GET` | `/{projectKey}/product-types?limit=500` | `results[].attributes.length` |
| **Get schema counts** | `GET` | `/{projectKey}/types?limit=500` | `results[].fieldDefinitions.length` |
| **Fetch Product schema** | `GET` | `/{projectKey}/product-types` | `results[].attributes[]` → `name`, `type.name`, `label` |
| **Fetch Custom schema** | `GET` | `/{projectKey}/types` | `results[].resourceTypeIds[]`, `fieldDefinitions[]` → `name`, `type.name`, `label` |

**CTP `product-types` response shape used:**
```json
{
  "results": [{
    "attributes": [{
      "name":  "color",
      "type":  { "name": "text" },
      "label": { "en": "Color" }
    }]
  }]
}
```

**CTP `types` response shape used:**
```json
{
  "results": [{
    "resourceTypeIds": ["order", "customer"],
    "fieldDefinitions": [{
      "name":  "externalId",
      "type":  { "name": "String" },
      "label": { "en": "External ID" }
    }]
  }]
}
```

---

### SFCC OCAPI APIs Used — CREATE Schema

All SFCC calls use **BM User Grant** token. Token endpoint:

```
POST {SFCC_BASE_URL}/dw/oauth2/access_token?client_id={bmClientId}
Authorization: Basic base64(bmUsername:bmPassword:bmClientId)
Body: grant_type=urn:demandware:params:oauth:grant-type:client-id:dwsid:dwsecuretoken
```

> `bmClientId` is always `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (well-known SFCC client)

| Purpose | Method | SFCC OCAPI Endpoint | When called |
|---------|--------|--------------------|-------------|
| **Check existing attrs** | `GET` | `/s/-/dw/data/{metaVersion}/system_object_definitions/{ObjectType}/attribute_definitions?count=200&start={n}` | Before creating — avoids duplicates |
| **Create attribute** | `PUT` | `/s/-/dw/data/{metaVersion}/system_object_definitions/{ObjectType}/attribute_definitions/{attrId}` | For each missing attribute |

**`metaVersion`** = `v25_6` (from `config.js`)

**GET response shape checked:**
```json
{
  "total": 45,
  "data": [
    { "id": "color" },
    { "id": "size" }
  ]
}
```

**PUT request body sent:**
```json
{
  "id":                 "color",
  "value_type":         "string",
  "mandatory":          false,
  "searchable":         false,
  "externally_defined": false,
  "externally_managed": false,
  "order_required":     false,
  "display_name":       { "default": "Color" }
}
```

**SFCC ObjectType values used:**

| SFCC System Object | Maps from CTP |
|-------------------|--------------|
| `Product` | `/product-types` attributes |
| `Category` | `/types` where resourceTypeId = `category` |
| `Customer` | `/types` where resourceTypeId = `customer` |
| `Order` | `/types` where resourceTypeId = `order`, `cart`, `line-item`, `payment` |
| `ProductInventoryRecord` | `/types` where resourceTypeId = `inventory-entry` |
| `ProductList` | `/types` where resourceTypeId = `shopping-list` |
| `ProductListItem` | `/types` where resourceTypeId = `shopping-list-text-line-item` |
| `Promotion` | `/types` where resourceTypeId = `cart-discount`, `discount-code` |

---

## Type Mapping — `typeMap.js`

All type conversions live in one file. No hardcoded types elsewhere.

### CTP ProductType attribute types → SFCC `value_type`

| CTP type | SFCC value_type |
|----------|----------------|
| `text` | `string` |
| `ltext` | `string` |
| `enum` | `string` |
| `lenum` | `string` |
| `number` | `double` |
| `boolean` | `boolean` |
| `date` | `date` |
| `time` | `string` |
| `datetime` | `datetime` |
| `money` | `double` |
| `reference` | `string` |
| `set` | `set-of-string` |
| `nested` | `string` |

### CTP Custom Type field types → SFCC `value_type`

| CTP FieldType | SFCC value_type |
|---------------|----------------|
| `String` | `string` |
| `LocalizedString` | `string` |
| `Number` | `double` |
| `Integer` | `int` |
| `Boolean` | `boolean` |
| `Date` | `date` |
| `Time` | `string` |
| `DateTime` | `datetime` |
| `Money` | `double` |
| `Enum` | `string` |
| `LocalizedEnum` | `string` |
| `Reference` | `string` |
| `Set` | `set-of-string` |

---

## SFCC Objects Covered

| SFCC Object | CTP Schema Source |
|-------------|-----------------|
| Product | `/product-types` → `attributes[]` |
| ProductActiveData | `/product-types` → `attributes[]` |
| Category | `/types` (resourceTypeId: `category`) |
| Customer / Profile | `/types` (resourceTypeId: `customer`) |
| Order | `/types` (resourceTypeId: `order`, `cart`) |
| OrderAddress | `/types` (resourceTypeId: `order`) |
| OrderItem / ProductLineItem | `/types` (resourceTypeId: `line-item`) |
| OrderPaymentInstrument | `/types` (resourceTypeId: `payment`) |
| PaymentMethod / PaymentCard | `/types` (resourceTypeId: `payment`) |
| PaymentTransaction | `/types` (resourceTypeId: `payment`) |
| ProductInventoryList | `/types` (resourceTypeId: `inventory-entry`) |
| ProductInventoryRecord | `/types` (resourceTypeId: `inventory-entry`) |
| ProductList | `/types` (resourceTypeId: `shopping-list`) |
| ProductListItem | `/types` (resourceTypeId: `shopping-list-text-line-item`) |
| ProductListRegistrant | `/types` (resourceTypeId: `shopping-list`) |
| ProductListItemPurchase | `/types` (resourceTypeId: `shopping-list`) |
| Promotion / PriceAdjustment | `/types` (resourceTypeId: `cart-discount`, `discount-code`) |
| PriceBook | `/types` (resourceTypeId: `standalone-price`) |
| Library | ❌ No CTP equivalent — skipped |
| OrganizationPreferences | ❌ No CTP equivalent — skipped |

---

## Setup

### Step 1: Fill `.env`
```bash
cp .env.example .env
```
```env
CTP_PROJECT_KEY=your-project-key
CTP_CLIENT_ID=your-client-id
CTP_CLIENT_SECRET=your-client-secret
CTP_AUTH_URL=https://auth.us-central1.gcp.commercetools.com
CTP_API_URL=https://api.us-central1.gcp.commercetools.com
SFCC_CATALOG_ID=storefront-catalog-m-en
SFCC_VERSION=v25_6
SFCC_META_VERSION=v25_6
```

### Step 2: Fill `dw.json`
```json
{
    "hostname": "your-instance.dx.commercecloud.salesforce.com",
    "username": "your-bm-username@company.com",
    "password": "your-bm-password",
    "version": "version1",
    "code-version": "version1"
}
```

### Step 3: Install + Upload
```bash
npm install
npm run uploadCartridge
```
Automatically: generates `config.js` + `sfcc-credentials.js`, then uploads all cartridges.

### Step 4: SFCC OCAPI Permissions
**BM → Administration → Site Development → Open Commerce API Settings → Data**

Add for client `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`:
```json
{
  "client_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "resources": [
    {
      "resource_id": "/system_object_definitions/**",
      "methods": ["get", "put"],
      "read_attributes": "(**)",
      "write_attributes": "(**)"
    }
  ]
}
```

### Step 5: Add to Cartridge Path
**BM → Administration → Sites → Manage Sites → your site → Settings**

Add `bm_accelerator` to the Cartridge Path.

---

## Notes

**Schema migration is safe to re-run.** Before creating each attribute, the tool checks existing definitions (`GET`). Attributes that already exist are skipped — nothing is overwritten.

**`typeMap.js` is the only place with type values.** If a mapping needs to change, edit only this file. Transformers and runners have no hardcoded type strings.

**`config.js` and `sfcc-credentials.js` ship as stubs** (pointing at defaults). Run `npm run config:generate` before upload to inject real CTP/BM credentials from `.env` + `dw.json`. Do not commit generated files that contain secrets.
