# B2C Migration Console — Project Overview

## What is this project?

This is a plugin (cartridge) for **Salesforce Commerce Cloud (SFCC) Business Manager**. Its job is simple: it reads the product fields, customer fields, and order fields from another eCommerce platform (like commercetools or Shopify) and automatically creates the same fields inside SFCC.

Think of it as a **data structure translator** — it takes the "shape" of data from one platform and recreates it in another.

---

## How it works — Big Picture

```
┌─────────────────────┐         ┌────────────────────────┐         ┌──────────────────┐
│   Source Platform   │ ──────► │  Migration Console     │ ──────► │  SFCC Business   │
│                     │  reads  │  (runs inside SFCC BM) │ creates │  Manager         │
│  commercetools  OR  │         │                        │         │                  │
│  Shopify            │         │  5-step guided wizard  │         │  Custom fields   │
│  (more coming soon) │         │                        │         │  on Products,    │
└─────────────────────┘         └────────────────────────┘         │  Orders, etc.    │
                                                                   └──────────────────┘
```

---

## The 5-Step Wizard

The tool guides the user through 5 steps:

### Step 1 — Connect
The user enters their login credentials for the source platform (commercetools or Shopify). The tool tests the connection and saves the credentials for the next steps.

| Platform      | What you need                              |
|---------------|--------------------------------------------|
| commercetools | Project Key, Client ID, Secret, API URL    |
| Shopify   | Store URL, Client ID, Secret               |

### Step 2 — Fetch
The tool connects to the source platform and counts all available field definitions. It shows a breakdown so the user can choose which data types to migrate (Products, Orders, Customers, etc.).

### Step 3 — AI Map
The tool shows a preview of how each source field will map to an SFCC field type. Each mapping gets a confidence score (High / Medium / Low) based on how closely the data types match. Fields that already exist in SFCC are highlighted so they won't be created twice.

| Source field type | SFCC field type |
|-------------------|-----------------|
| Text / String     | string          |
| Number / Decimal  | double          |
| Whole Number      | int             |
| True/False        | boolean         |
| Date              | date            |
| List of text      | set_of_string   |
| Price / Money     | double          |

### Step 4 — Move
This is where the actual migration happens. The tool creates the field definitions inside SFCC one batch at a time (max 10 per request, to stay within SFCC's limits). It shows live progress per object type and reports how many were created, skipped, or failed.

### Step 5 — View
A final summary report showing:
- How many fields were created in each object type
- Which fields were skipped (already existed)
- Which fields failed
- A reset button to delete all created fields (for testing only)

---

## Supported Platforms

| Platform       | Status       | What gets migrated                                      |
|----------------|--------------|---------------------------------------------------------|
| commercetools  | Ready        | Products, Categories, Customers, Orders, Inventory, Lists, Promotions |
| Shopify    | Ready        | Products (14 standard fields + custom metafields), Customers, Orders |
| BigCommerce    | Coming Soon  | —                                                       |
| Salesforce B2C | Coming Soon  | —                                                       |
| SAP Commerce   | Coming Soon  | —                                                       |

---

## What gets created in SFCC?

Fields are created as **custom attribute definitions** on these SFCC system object types:

| SFCC Object Type       | Example fields                        |
|------------------------|---------------------------------------|
| Product                | title, vendor, price, SKU, tags       |
| Category               | custom category fields                |
| Customer               | custom customer fields                |
| Order                  | custom order fields                   |
| ProductInventoryRecord | inventory-related fields              |
| ProductList            | wishlist / shopping list fields       |
| Promotion              | discount and promotion fields         |

---

## How the code is organized

```
bm_accelerator/
├── controllers/
│   └── Accelerator.js          ← Handles all web requests from the browser
├── scripts/
│   ├── accelerator/
│   │   └── migrationData.js    ← Defines all platforms and wizard steps
│   └── migration/
│       ├── config.js           ← Your actual credentials (never committed to git)
│       ├── config.defaults.js  ← Empty template (safe to commit)
│       ├── configAccessor.js   ← Combines config file + session credentials
│       ├── sfccClient.js       ← Talks to the SFCC API to create fields
│       ├── core/
│       │   ├── http.js         ← Simple wrapper for making HTTP requests
│       │   ├── attrBuilder.js  ← Builds the correct format for SFCC fields
│       │   └── runner.js       ← Runs migration in small batches
│       └── connectors/
│           ├── registry.js         ← Lists all available platform connectors
│           ├── ctp/                ← commercetools connector
│           └── shopify/            ← Shopify connector
└── templates/
    └── accelerator/
        ├── dashboard.isml      ← Platform selection screen
        ├── wizard.isml         ← Wizard wrapper
        └── components/
            ├── stepConnect.isml    ← Step 1 screen
            ├── stepFetch.isml      ← Step 2 screen
            ├── stepAiMap.isml      ← Step 3 screen
            ├── stepMove.isml       ← Step 4 screen
            └── stepView.isml       ← Step 5 screen
```

---

## Adding a New Platform

The system is designed to be easily extended. To add a new platform:

1. Create a new connector folder under `connectors/`
2. Implement the standard connector interface (connect, fetch, map, migrate)
3. Register it in `registry.js`

No other files need to change.

---

## How Authentication Works

Each system uses its own login method:

**commercetools:**
The tool sends the Client ID and Secret to get a temporary access token, then uses that token for all API calls.

**Shopify:**
Same approach — Client ID + Secret are exchanged for a short-lived access token (valid ~24 hours). The token is used in every API request header.

**SFCC (to create fields):**
The tool uses the Business Manager username, password, and Client ID to get a SFCC access token, then uses that token to call the SFCC Data API to create the field definitions.

---

## Security Rules

| File                     | Saved to Git? | Why                                      |
|--------------------------|---------------|------------------------------------------|
| `config.js`              | NO            | Contains live API credentials — secret  |
| `config.defaults.js`     | YES           | Empty template, no real credentials      |
| `sfcc-credentials.js`    | NO            | Contains BM username and password        |
| `sfcc-credentials.defaults.js` | YES    | Empty template                           |

GitHub automatically blocks any commit that contains API keys or secrets.

---

## Browser Endpoints (URLs)

| URL                             | What it does                          |
|---------------------------------|---------------------------------------|
| `Accelerator-Start`             | Opens the platform selection screen   |
| `Accelerator-Wizard`            | Opens the 5-step wizard               |
| `Accelerator-TestConnection`    | Tests if credentials are correct      |
| `Accelerator-GetSchema`         | Loads field counts from source        |
| `Accelerator-GetAiMap`          | Loads the field mapping preview       |
| `Accelerator-GetExistingAttrs`  | Checks what already exists in SFCC    |
| `Accelerator-RunMigration`      | Creates one batch of fields in SFCC   |
| `Accelerator-SaveMigrationResults` | Saves the migration results        |
| `Accelerator-DeleteAttributes`  | Deletes all migrated fields (reset)   |

---

## Amplience content migration & React storefront

Content migration (Amplience → SFCC → React) is documented separately:

**[Amplience Content — Data Flow & Architecture](amplience-content-data-flow.md)**

Covers: BM wizard import, SFCC catalog APIs, React gallery, Amplience CDN live fetch, Headless Page Designer, and dev vs production behaviour.

Local React demo: `react-storefront/README.md`
