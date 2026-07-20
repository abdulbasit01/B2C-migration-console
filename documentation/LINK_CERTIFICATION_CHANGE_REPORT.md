# LINK Certification Change Report — `bm_accelerator`

**Date:** 2026-07-20  
**Cartridge version:** 1.0.0  
**Scope:** Project structure, BM extensions, Service Framework, configuration, security, logging, error handling, performance/configurability, upgradeability, versioning, documentation

---

## Summary

Hard blockers for LINK Marketplace readiness were addressed in code and packaging: secrets removed from tracked defaults, Service Framework introduced for all outbound HTTP, Site Preference metadata added, CSRF + BM auth guards applied, deterministic passwords removed, credential logging eliminated, SFRA Page Designer leftovers removed, and LINK documentation added.

---

## Changes made

### 1. Secrets & configuration

| Change | Files |
|--------|-------|
| Removed all real Shopify/CTP/BM credentials from tracked defaults | `config.defaults.js`, `sfcc-credentials.defaults.js` |
| Empty placeholders only; comments forbid committing secrets | same |
| Site Preferences metadata for merchant-configurable settings (password-typed secrets) | `metadata/meta/system-objecttype-extensions.xml` |
| Preference accessor overlays prefs over generated/file config | `migrationPreferences.js`, `configAccessor.js`, `sfccCredentialsAccessor.js` |
| Stopped storing Shopify **client secrets** in `session.custom` | `Accelerator.js`, `configAccessor.js` |
| Timeouts configured via Service Framework profiles (not site prefs) | `metadata/services.xml` |

### 2. Service Framework

| Change | Files |
|--------|-------|
| Added `services.xml` with accelerator.* HTTP services + profiles | `metadata/services.xml` |
| Central `serviceHttp.js` using `LocalServiceRegistry` + log filtering | `scripts/migration/core/serviceHttp.js` |
| Replaced raw `HTTPClient` in shared HTTP stack | `http.js`, `shopifyApi.js`, `sfccClient.js`, `webDavUploader.js` |
| Migrated catalog CT/OCAPI callers | `fetchCTCategories.js`, `importCategories.js` |
| Migrated OCAPI writers/migrators | `sfccCustomerGroupWriter.js`, `sfccShippingMethodWriter.js`, `ocapiProductMigrator.js` |
| Migrated controller OCAPI/CTP calls | `Accelerator.js` (GetSites, jobs, catalogs, CreateCTCategory, CreateCatalogOCAPI) |
| Removed diagnostic dual-token catalog create path that leaked token bodies to clients | `CreateCatalogOCAPI` |

**Verification:** no remaining `dw/net/HTTPClient` references under `bm_accelerator`.

### 3. Security

| Change | Files |
|--------|-------|
| BM `session.userAuthenticated` + CSRF validation on mutating AJAX | `requestGuard.js`, wrap at end of `Accelerator.js` |
| CSRF meta tags + client auto-inject for XHR/forms/beacon | `MenuFrame.isml`, `client/.../csrf.js`, `static/.../csrf.js` |
| Random temporary customer passwords (`tempPassword.js`) | customer XML builders + runners + UI copy |
| Removed deterministic `Rc1!`+ID password formula from UI | `customerMigration.isml` |

### 4. Logging & error handling

| Change | Files |
|--------|-------|
| Named log categories under `bm_accelerator` | `migrationLogger.js` |
| Stopped logging full OAuth response bodies / tokens | `fetchCTCategories.js`, `importCategories.js`, `sfccClient.js` |
| Service log filter redacts tokens, Basic auth, Shopify tokens | `serviceHttp.js` |
| CreateCatalogOCAPI errors no longer return raw token response bodies | `Accelerator.js` |

### 5. BM extension standards

| Change | Files |
|--------|-------|
| ISO-8859-1 encoding; icon element; explicit sub-pipelines | `bm_extensions.xml` |
| Cartridge semver property | `bm_accelerator.properties` (`version=1.0.0`) |

### 6. Cleanup & documentation

| Change | Files |
|--------|-------|
| Removed SFRA Page Designer `experience/` leftovers from BM cartridge | deleted `cartridge/experience/**` |
| LINK docs package | `documentation/README.md`, `link_installation.md`, `link_user_guide.md` |

---

## Remaining items requiring manual attention

1. **Rotate compromised credentials immediately**  
   Tracked defaults previously contained live Shopify client secret, CTP secret, and BM password. Assume compromised; rotate in Shopify Partners, commercetools, and SFCC Account Manager / BM users.

2. **Import metadata on each instance**  
   Import `metadata/services.xml` and `metadata/meta/system-objecttype-extensions.xml` via Site Import. Enable services in BM.

3. **Add menu icon asset**  
   `bm_extensions.xml` references `icons/accelerator.png` — add a real PNG under `cartridge/static/default/icons/` (or update the path).

4. **Complete `sub-pipelines` inventory**  
   Primary menuaction lists major pipelines; remaining AJAX nodes (~80+) should be registered under the owning menuaction (or a dedicated action) so role permission checks match BM standards. Audit with a non-admin role.

5. **Production credential strategy**  
   Credentials are Site Preferences only (no generated `config.js` / `sfcc-credentials.js`).

6. **OCAPI / WebDAV permissions**  
   Ensure the BM API client and user used for migration have Jobs, System Object Definitions, Catalogs, Customer Groups, Shipping Methods, and WebDAV IMPEX access as needed.

7. **XSS / `encoding="off"` review**  
   Several ISML templates still use `encoding="off"` for trusted HTML/JSON blobs and some client `innerHTML` paths. Harden escaping for any source-platform field rendered in BM UI before certification.

8. **Multi-locale BM menu strings**  
   Only `x-default` is provided; add `de`/`fr`/etc. if LINK localization is required.

9. **Root README**  
   Repository root `README.md` is still stock SFRA text — replace or point to `documentation/` for the LINK package.

10. **Functional regression test**  
    After deploy: Test Connection (Shopify + CTP), one schema migrate, one data export, CSRF on POST (expect 403 without token), and confirm services appear under Operations → Services.

11. **Password reset process**  
    Document merchant process for forcing password reset after customer IMPEX import (passwords are random, not recoverable from source ID).

12. **hooks.json**  
    Remains empty (`hooks: []`) — acceptable if unused; remove package hook pointer if LINK reviewers flag empty hooks.

---

## Recommended next certification steps

1. Rotate secrets → import metadata → upload cartridge → configure prefs  
2. Role-based permission test  
3. LINK packaging ZIP (cartridge + metadata + documentation)  
4. Security questionnaire responses aligned with this report  
5. Optional: Bugbot / security review of remaining ISML XSS surfaces
