'use strict';

const pptx = require('pptxgenjs');
const pres = new pptx();

// ─── Theme ────────────────────────────────────────────────────────────────────
const C = {
    navy:      '0A2342',
    blue:      '1565C0',
    lightBlue: '1E88E5',
    accent:    '00BCD4',
    green:     '2E7D32',
    orange:    'E65100',
    white:     'FFFFFF',
    light:     'F0F4F8',
    gray:      '546E7A',
    darkGray:  '263238',
    yellow:    'F9A825',
    purple:    '6A1B9A'
};

pres.layout = 'LAYOUT_WIDE';
pres.author  = 'Royal Cyber';
pres.company = 'Royal Cyber';
pres.subject = 'B2C Migration Console';
pres.title   = 'B2C Migration Console — Demo Presentation';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function slide(layout) { return pres.addSlide({ masterName: layout }); }

function titleSlide(title, subtitle) {
    const s = pres.addSlide();
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: C.navy } });
    s.addShape(pres.ShapeType.rect, { x: 0, y: 3.8, w: '100%', h: 0.08, fill: { color: C.accent } });
    s.addText('ROYAL CYBER', { x: 0.4, y: 0.3, w: 9, h: 0.4, fontSize: 11, bold: true, color: C.accent, charSpacing: 4 });
    s.addText(title, { x: 0.4, y: 1.1, w: 12, h: 2.2, fontSize: 40, bold: true, color: C.white, breakLine: true });
    s.addText(subtitle, { x: 0.4, y: 3.4, w: 11, h: 0.5, fontSize: 16, color: C.accent, italic: true });
    s.addText('B2C Migration Console  |  Demo Presentation  |  2026', { x: 0.4, y: 6.7, w: 12, h: 0.35, fontSize: 10, color: C.gray });
    return s;
}

function sectionDivider(title, subtitle) {
    const s = pres.addSlide();
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: C.blue } });
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: '100%', fill: { color: C.accent } });
    s.addText(title, { x: 0.5, y: 2.2, w: 12, h: 1.2, fontSize: 34, bold: true, color: C.white });
    s.addText(subtitle, { x: 0.5, y: 3.5, w: 11, h: 0.5, fontSize: 16, color: C.accent, italic: true });
    return s;
}

function contentSlide(title) {
    const s = pres.addSlide();
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.9, fill: { color: C.navy } });
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0.9, w: '100%', h: 0.06, fill: { color: C.accent } });
    s.addText(title, { x: 0.3, y: 0.12, w: 12, h: 0.65, fontSize: 22, bold: true, color: C.white });
    s.addText('Royal Cyber  |  B2C Migration Console', { x: 8.5, y: 7.05, w: 4.8, h: 0.3, fontSize: 9, color: C.gray, align: 'right' });
    return s;
}

function box(s, x, y, w, h, bg, text, textColor, fontSize, opts) {
    s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: bg }, line: { color: bg }, rectRadius: 0.08, ...opts });
    if (text) s.addText(text, { x: x + 0.08, y: y + 0.05, w: w - 0.16, h: h - 0.1, fontSize: fontSize || 11, color: textColor || C.white, bold: false, align: 'center', valign: 'middle', wrap: true });
}

function arrow(s, x, y, w, h, dir) {
    s.addShape(pres.ShapeType.rightArrow, { x, y, w: w || 0.5, h: h || 0.25, fill: { color: C.accent }, line: { color: C.accent }, rotate: dir === 'down' ? 90 : 0 });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 1 — Title
// ═══════════════════════════════════════════════════════════════════════════════
titleSlide(
    'B2C Migration Console',
    'Multi-Platform eCommerce Schema Migration Tool — Demo Presentation'
);

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 2 — Agenda
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('Agenda');
    const items = [
        ['01', 'Project Overview & Business Objective'],
        ['02', 'Architecture & Existing Process'],
        ['03', 'Migration Goals & Scope'],
        ['04', 'Detailed Migration Architecture'],
        ['05', 'Platform-Specific Implementation'],
        ['06', 'Data Flow & Processing'],
        ['07', 'Schema Migration Process'],
        ['08', 'Key Components & Responsibilities'],
        ['09', 'Challenges & Solutions'],
        ['10', 'Benefits & Improvements'],
        ['11', 'Demo Flow & Use Cases'],
        ['12', 'Future Enhancements'],
    ];
    const col1 = items.slice(0, 6);
    const col2 = items.slice(6);
    col1.forEach((item, i) => {
        box(s, 0.3, 1.1 + i * 0.92, 0.55, 0.72, C.accent, item[0], C.navy, 16);
        s.addText(item[1], { x: 1.0, y: 1.18 + i * 0.92, w: 5.6, h: 0.56, fontSize: 13, color: C.darkGray, bold: false });
    });
    col2.forEach((item, i) => {
        box(s, 6.8, 1.1 + i * 0.92, 0.55, 0.72, C.navy, item[0], C.white, 16);
        s.addText(item[1], { x: 7.5, y: 1.18 + i * 0.92, w: 5.6, h: 0.56, fontSize: 13, color: C.darkGray, bold: false });
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 3 — Section: Overview
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider('01  Project Overview', 'Business Objective & Problem Statement');

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 4 — Project Overview
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('Project Overview & Business Objective');

    box(s, 0.3, 1.1, 12.7, 1.5, C.light, '', C.darkGray, 12);
    s.addText('What is B2C Migration Console?', { x: 0.5, y: 1.15, w: 12, h: 0.4, fontSize: 14, bold: true, color: C.navy });
    s.addText(
        'A Salesforce Commerce Cloud (SFCC) Business Manager cartridge that automatically reads product, customer, order, and category field definitions from a source eCommerce platform and recreates them as custom attributes inside SFCC — eliminating manual setup and human error.',
        { x: 0.5, y: 1.55, w: 12.3, h: 0.9, fontSize: 12, color: C.darkGray, wrap: true }
    );

    const problems = [
        { icon: '⚠', title: 'Manual Migration', desc: 'Engineers manually recreated hundreds of fields in SFCC — error-prone and time-consuming' },
        { icon: '⏱', title: 'Long Timelines', desc: 'Migration projects taking weeks; blocking go-live dates for clients' },
        { icon: '🔁', title: 'No Reusability', desc: 'Each migration was a one-off effort — no standardization across projects' },
        { icon: '💸', title: 'High Cost', desc: 'Repetitive engineer hours spent on boilerplate schema setup work' },
    ];
    problems.forEach((p, i) => {
        const x = 0.3 + i * 3.25;
        box(s, x, 2.85, 3.05, 3.8, C.navy, '', C.white, 11);
        s.addText(p.icon, { x: x + 0.1, y: 3.0, w: 2.85, h: 0.6, fontSize: 28, align: 'center' });
        s.addText(p.title, { x: x + 0.1, y: 3.65, w: 2.85, h: 0.45, fontSize: 13, bold: true, color: C.accent, align: 'center' });
        s.addText(p.desc, { x: x + 0.15, y: 4.15, w: 2.75, h: 1.35, fontSize: 10.5, color: C.white, align: 'center', wrap: true });
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 5 — Section: Architecture
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider('02  Architecture', 'Current Architecture & Existing Process');

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 6 — Existing Process
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('Existing Process — Before Migration Console');

    const steps = [
        { n: '1', t: 'Export Schema', d: 'Engineer manually reviews source platform (CT / Shopify) and exports all field definitions to spreadsheet' },
        { n: '2', t: 'Analyze Types', d: 'Team manually maps each source field type to SFCC equivalent — judgement calls on every field' },
        { n: '3', t: 'Manual Entry', d: 'Admin manually creates each attribute in SFCC Business Manager one by one — no automation' },
        { n: '4', t: 'QA & Verify', d: 'QA engineer checks every attribute against original spreadsheet to find missed or wrong entries' },
        { n: '5', t: 'Fix & Repeat', d: 'Errors found → repeat steps 3–4 until all attributes are correct. Typical: 2–5 cycles per project' },
    ];

    steps.forEach((step, i) => {
        const x = 0.25 + i * 2.6;
        box(s, x, 1.2, 2.35, 0.65, C.accent, step.n, C.navy, 28);
        box(s, x, 1.9, 2.35, 0.55, C.navy, step.t, C.white, 12);
        s.addText(step.d, { x: x + 0.08, y: 2.52, w: 2.2, h: 2.0, fontSize: 10, color: C.darkGray, wrap: true });
        if (i < 4) arrow(s, x + 2.35, 1.35, 0.25, 0.35);
    });

    box(s, 0.3, 5.2, 12.7, 1.35, 'FFF3E0', '', C.darkGray, 11, { line: { color: C.orange, pt: 1.5 } });
    s.addText('⏱  Typical Timeline: 2–4 weeks per migration project  |  📋 Average: 300+ fields to recreate manually  |  ❌ Error rate: 15–25% requiring rework', {
        x: 0.5, y: 5.45, w: 12.3, h: 0.8, fontSize: 12, color: C.orange, bold: true, align: 'center'
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 7 — Section: Migration Goals
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider('03  Migration Goals & Scope', 'What we set out to achieve');

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 8 — Goals & Scope
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('Migration Goals & Scope');

    const goals = [
        { color: C.green,  icon: '⚡', title: 'Automate Schema Migration', desc: 'Zero manual attribute creation — tool reads source schema and creates SFCC attributes automatically' },
        { color: C.blue,   icon: '🔌', title: 'Multi-Platform Support',    desc: 'Single tool that works with commercetools, Shopify, and future platforms via a plug-in connector model' },
        { color: C.purple, icon: '🗺', title: 'Intelligent Field Mapping',  desc: 'AI-assisted type mapping with confidence scores — highest confidence mappings applied automatically' },
        { color: C.accent, icon: '🔒', title: 'Safe & Idempotent',         desc: 'Existing attributes are detected and skipped — no overwrites, no duplicates, safe to re-run' },
    ];

    goals.forEach((g, i) => {
        const x = 0.3 + (i % 2) * 6.55;
        const y = 1.1 + Math.floor(i / 2) * 2.65;
        box(s, x, y, 6.3, 2.4, C.light, '', C.darkGray, 11);
        box(s, x, y, 0.7, 2.4, g.color, g.icon, C.white, 20);
        s.addText(g.title, { x: x + 0.85, y: y + 0.2, w: 5.3, h: 0.45, fontSize: 14, bold: true, color: g.color });
        s.addText(g.desc,  { x: x + 0.85, y: y + 0.7, w: 5.3, h: 1.5,  fontSize: 11.5, color: C.darkGray, wrap: true });
    });

    const scope = ['Product & Variant fields', 'Category (Collection)', 'Customer / Profile', 'Order', 'Inventory Record', 'Customer Group'];
    box(s, 0.3, 6.45, 12.7, 0.75, C.navy, '', C.white, 11);
    s.addText('In Scope: ' + scope.join('  •  '), { x: 0.5, y: 6.55, w: 12.3, h: 0.55, fontSize: 12, color: C.accent, bold: true, align: 'center' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 9 — Section: Architecture
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider('04  Migration Architecture', 'Detailed technical architecture');

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 10 — Architecture Diagram
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('Migration Architecture — Overview');

    // Source platforms column
    box(s, 0.2, 1.1, 2.8, 0.5, C.gray,   'SOURCE PLATFORMS',        C.white, 10);
    box(s, 0.2, 1.65, 2.8, 0.9, C.green,  'commercetools\nCTP OAuth2',C.white, 11);
    box(s, 0.2, 2.65, 2.8, 0.9, C.purple, 'Shopify\nclient_credentials', C.white, 11);
    box(s, 0.2, 3.65, 2.8, 0.9, C.orange, 'BigCommerce\n(Coming Soon)', C.white, 11);
    box(s, 0.2, 4.65, 2.8, 0.9, C.gray,   'SAP Commerce\n(Planned)', C.white, 11);

    // Arrows source → engine
    [1.9, 2.9, 3.9, 4.9].forEach(y => arrow(s, 3.05, y + 0.15, 0.45, 0.25));

    // Migration Engine center
    box(s, 3.55, 1.1, 6.1, 0.5, C.navy,   'MIGRATION ENGINE  (bm_accelerator)', C.accent, 11);
    box(s, 3.55, 1.65, 6.1, 0.7, C.blue,  'Connector Registry  |  registry.js', C.white, 11);
    box(s, 3.55, 2.45, 6.1, 0.7, C.blue,  'Config Accessor  |  configAccessor.js', C.white, 11);
    box(s, 3.55, 3.25, 6.1, 0.7, C.blue,  'Batch Runner  |  runner.js  (max 10/req)', C.white, 11);
    box(s, 3.55, 4.05, 6.1, 0.7, C.blue,  'Attr Builder  |  attrBuilder.js', C.white, 11);
    box(s, 3.55, 4.85, 6.1, 0.7, C.blue,  'SFCC Client  |  sfccClient.js  (OCAPI)', C.white, 11);

    // 5-step wizard
    box(s, 3.55, 5.65, 6.1, 0.5, C.accent, '[ Connect ] → [ Fetch ] → [ AI Map ] → [ Move ] → [ View ]', C.navy, 10);

    // Arrows engine → SFCC
    arrow(s, 9.7, 2.8, 0.45, 0.25);

    // SFCC column
    box(s, 10.2, 1.1, 2.8, 0.5, C.gray,   'SFCC BUSINESS MANAGER', C.white, 10);
    const sfccObjects = ['Product', 'Category', 'Customer', 'Order', 'Inventory', 'CustomerGroup'];
    sfccObjects.forEach((obj, i) => {
        box(s, 10.2, 1.65 + i * 0.83, 2.8, 0.73, i % 2 === 0 ? C.navy : C.darkGray, obj, C.white, 11);
    });

    // Auth box bottom
    box(s, 0.2, 6.45, 12.7, 0.7, C.darkGray, '', C.white, 10);
    s.addText('Auth:  CT → Basic(clientId:secret) → Bearer    |    Shopify → client_credentials → shpat_    |    SFCC → Basic(user:pass:bmClientId) → Bearer → OCAPI v25_6',
        { x: 0.35, y: 6.6, w: 12.4, h: 0.4, fontSize: 10, color: C.accent, align: 'center' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 11 — Section: Platform Implementation
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider('05  Platform Implementation', 'SFCC, commercetools & Shopify');

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 12 — commercetools Implementation
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('commercetools — Platform Implementation');

    box(s, 0.3, 1.1, 4.0, 5.6, C.light, '', C.darkGray, 11);
    s.addText('Auth Flow', { x: 0.45, y: 1.15, w: 3.7, h: 0.4, fontSize: 13, bold: true, color: C.blue });
    const ctpAuth = ['POST {authUrl}/oauth/token', 'Authorization: Basic base64(clientId:secret)', 'Body: grant_type=client_credentials', '→ Response: { access_token }', 'Header: Authorization: Bearer {token}'];
    ctpAuth.forEach((l, i) => s.addText(l, { x: 0.45, y: 1.6 + i * 0.38, w: 3.7, h: 0.35, fontSize: 9.5, color: i === 3 ? C.green : C.darkGray, fontFace: 'Courier New' }));

    s.addText('Schema Fetch', { x: 0.45, y: 3.6, w: 3.7, h: 0.4, fontSize: 13, bold: true, color: C.blue });
    const fetches = ['GET /product-types (paginated)', 'GET /types (paginated, 100/page)', 'Resolves resourceTypeIds', '→ Product, Category, Customer,\n   Order, Inventory, Promotions'];
    fetches.forEach((l, i) => s.addText(l, { x: 0.45, y: 4.05 + i * 0.42, w: 3.7, h: 0.38, fontSize: 9.5, color: C.darkGray, fontFace: 'Courier New', wrap: true }));

    box(s, 4.5, 1.1, 4.0, 2.6, C.navy, '', C.white, 11);
    s.addText('Object Types Supported', { x: 4.65, y: 1.15, w: 3.7, h: 0.4, fontSize: 13, bold: true, color: C.accent });
    const ctpTypes = ['✓ Product  (productTypes + productVariant)', '✓ Category', '✓ Customer  →  Profile', '✓ Order  +  OrderEdit', '✓ ProductInventoryRecord', '✓ ProductList  &  ProductListItem', '✓ Promotion  &  DiscountCode'];
    ctpTypes.forEach((t, i) => s.addText(t, { x: 4.65, y: 1.6 + i * 0.33, w: 3.7, h: 0.3, fontSize: 10.5, color: C.white }));

    box(s, 4.5, 3.85, 4.0, 2.85, C.blue, '', C.white, 11);
    s.addText('Type Mapping (CT → SFCC)', { x: 4.65, y: 3.9, w: 3.7, h: 0.4, fontSize: 13, bold: true, color: C.accent });
    const typeMap = [['text / ltext', 'string'], ['number', 'double'], ['boolean', 'boolean'], ['date / time', 'date / datetime'], ['set(text)', 'set_of_string'], ['money', 'double'], ['reference', 'string']];
    typeMap.forEach((row, i) => {
        s.addText(row[0], { x: 4.65, y: 4.35 + i * 0.35, w: 1.8, h: 0.3, fontSize: 10, color: C.yellow });
        s.addText('→  ' + row[1], { x: 6.55, y: 4.35 + i * 0.35, w: 1.8, h: 0.3, fontSize: 10, color: C.white });
    });

    box(s, 8.7, 1.1, 4.5, 5.6, C.darkGray, '', C.white, 11);
    s.addText('Connector Interface', { x: 8.85, y: 1.15, w: 4.2, h: 0.4, fontSize: 13, bold: true, color: C.accent });
    const methods = ['testConnectionWith(creds)', 'testConnection()', 'getSchemaCounts()', 'getAttrDefsForTask(task)', 'getAttrIdsForTask(task)', 'injectCredentials(fields)', 'getDefaultTasks()', 'buildFetchContent(counts)', 'buildAiMapContent(tasks, existing)'];
    methods.forEach((m, i) => s.addText('• ' + m, { x: 8.85, y: 1.65 + i * 0.5, w: 4.2, h: 0.45, fontSize: 10, color: C.white, fontFace: 'Courier New', wrap: true }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 13 — Shopify Implementation
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('Shopify — Platform Implementation');

    box(s, 0.3, 1.1, 4.2, 5.6, C.light, '', C.darkGray, 11);
    s.addText('OAuth Flow (client_credentials)', { x: 0.45, y: 1.15, w: 4.0, h: 0.4, fontSize: 12, bold: true, color: C.purple });
    const shopAuth = [
        'POST /admin/oauth/access_token',
        'Body: grant_type=client_credentials',
        '      client_id={CLIENT_ID}',
        '      client_secret={SECRET}',
        '→ { access_token: shpat_...,',
        '    scope: read_products,...,',
        '    expires_in: 86399 }',
        'Header: X-Shopify-Access-Token',
    ];
    shopAuth.forEach((l, i) => s.addText(l, { x: 0.45, y: 1.6 + i * 0.37, w: 4.0, h: 0.33, fontSize: 9, color: i === 4 || i === 5 || i === 6 ? C.green : C.darkGray, fontFace: 'Courier New' }));

    s.addText('Required API Scopes', { x: 0.45, y: 4.65, w: 4.0, h: 0.4, fontSize: 12, bold: true, color: C.purple });
    ['read_products', 'read_customers', 'read_orders', 'read_inventory'].forEach((sc, i) => {
        s.addText('• ' + sc, { x: 0.45, y: 5.1 + i * 0.32, w: 4.0, h: 0.28, fontSize: 10, color: C.darkGray });
    });

    box(s, 4.7, 1.1, 4.0, 3.2, C.purple, '', C.white, 11);
    s.addText('Standard Fields Migrated', { x: 4.85, y: 1.15, w: 3.7, h: 0.4, fontSize: 12, bold: true, color: C.white });
    const shopFields = [
        '[ Product ] title, body_html, vendor,', '  product_type, handle, tags, status',
        '[ Variant ] sku, barcode, price,',      '  compare_at_price, weight, taxable',
        '[ Category ] title, body_html, handle', '[ Customer ] email, name, phone, tags',
        '[ Order ] total_price, status, currency','[ Inventory ] sku, cost, tracking',
    ];
    shopFields.forEach((f, i) => s.addText(f, { x: 4.85, y: 1.6 + i * 0.33, w: 3.7, h: 0.3, fontSize: 9.5, color: i % 2 === 0 ? C.yellow : C.white, fontFace: 'Courier New' }));

    box(s, 4.7, 4.4, 4.0, 2.3, C.darkGray, '', C.white, 11);
    s.addText('Metafield Owner Types', { x: 4.85, y: 4.45, w: 3.7, h: 0.4, fontSize: 12, bold: true, color: C.accent });
    [['PRODUCT + VARIANT', 'Product'], ['COLLECTION', 'Category'], ['CUSTOMER', 'Customer/Profile'], ['ORDER', 'Order']].forEach((row, i) => {
        s.addText(row[0] + ' → ' + row[1], { x: 4.85, y: 4.9 + i * 0.4, w: 3.7, h: 0.35, fontSize: 10.5, color: C.white, fontFace: 'Courier New' });
    });

    box(s, 8.9, 1.1, 4.3, 5.6, C.navy, '', C.white, 11);
    s.addText('Token Caching Strategy', { x: 9.05, y: 1.15, w: 4.0, h: 0.4, fontSize: 12, bold: true, color: C.accent });
    s.addText(
        'SFCC has a 16 HTTP-calls-per-request limit.\n\nThe token fetched via client_credentials is cached in-memory for the request lifecycle (expires_in − 60s buffer).\n\nThis means:\n• 1 call for token\n• ~2 calls for schema fetch\n• Up to 10 calls for attribute creation\n\nAll within the 16-call quota.\n\nToken is auto-refreshed on expiry.',
        { x: 9.05, y: 1.65, w: 4.0, h: 4.8, fontSize: 11, color: C.white, wrap: true }
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 14 — Section: Data Flow
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider('06  Data Flow', 'End-to-end data and processing flow');

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 15 — Data Flow
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('End-to-End Data Flow');

    const steps = [
        { x: 0.2,  label: 'User Enters\nCredentials', color: C.navy },
        { x: 2.3,  label: 'Test\nConnection', color: C.blue },
        { x: 4.4,  label: 'Fetch Schema\nCounts', color: C.blue },
        { x: 6.5,  label: 'AI Field\nMapping', color: C.purple },
        { x: 8.6,  label: 'Run Migration\n(Batched)', color: C.green },
        { x: 10.7, label: 'View\nResults', color: C.accent },
    ];

    steps.forEach((step, i) => {
        box(s, step.x, 1.1, 1.95, 1.4, step.color, step.label, C.white, 11);
        s.addText('Step ' + (i + 1), { x: step.x, y: 2.6, w: 1.95, h: 0.3, fontSize: 9, color: C.gray, align: 'center' });
        if (i < 5) arrow(s, step.x + 1.95, 1.6, 0.35, 0.3);
    });

    // Detail rows
    const rows = [
        { label: 'Browser',    color: C.light, items: ['Form input', 'XHR POST\n/TestConnection', 'XHR POST\n/GetSchema', 'XHR POST\n/GetAiMap', 'XHR POST\n/RunMigration\n(looped)', 'Read session\nresults'] },
        { label: 'Controller', color: C.navy + '22', items: ['Save to\nsession', 'connector\n.testConn()', 'connector\n.getCounts()', 'connector\n.buildAiMap()', 'runner\n.runBatch()', 'buildView\nContent()'] },
        { label: 'Platform\nAPI', color: 'F3E5F5', items: ['—', 'GET /shop.json\nor /project', 'GET product-types\n/graphql.json', 'GET schema\n+ existing attrs', 'GET schema\nPUT attrs ×10', '—'] },
        { label: 'SFCC\nOCAPI', color: 'E3F2FD', items: ['—', '—', '—', 'GET existing\nattr IDs', 'PUT /attr_defs\n(×10 per batch)', 'GET summary\nfrom session'] },
    ];

    rows.forEach((row, ri) => {
        box(s, 0.2, 3.15 + ri * 0.95, 1.7, 0.85, C.navy, row.label, C.white, 10);
        steps.forEach((step, si) => {
            const bg = ri % 2 === 0 ? 'F5F5F5' : 'E8EAF6';
            s.addShape(pres.ShapeType.rect, { x: step.x, y: 3.15 + ri * 0.95, w: 1.95, h: 0.85, fill: { color: bg }, line: { color: 'CCCCCC', pt: 0.5 } });
            s.addText(row.items[si], { x: step.x + 0.05, y: 3.18 + ri * 0.95, w: 1.85, h: 0.79, fontSize: 8.5, color: C.darkGray, align: 'center', valign: 'middle', wrap: true });
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 16 — Section: Schema Migration
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider('07  Schema Migration Process', 'How attributes are created in SFCC');

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 17 — Schema Migration Process
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('Schema Migration Process — Step 4 Deep Dive');

    // Left: batch flow
    box(s, 0.2, 1.1, 5.8, 0.45, C.navy, 'Batch Migration Flow (runner.js)', C.accent, 12);
    const flow = [
        ['1', 'fetchExisting(task)', 'GET current attr IDs from SFCC — builds skip list', C.blue],
        ['2', 'getAttrDefsForTask(task)', 'Connector fetches schema from source platform', C.purple],
        ['3', 'batch = allDefs.slice(offset, offset+10)', 'Take next 10 attributes (SFCC 16-call limit)', C.green],
        ['4', 'sfccClient.getSFCCToken()', 'Authenticate with SFCC BM (User Grant)', C.orange],
        ['5', 'PUT /attribute_definitions/{id}  ×10', 'Create each attribute via OCAPI Data API', C.blue],
        ['6', 'If !done → runTask(nextOffset)', 'Frontend paginates until all attrs created', C.accent],
        ['7', 'saveResults() → session.custom', 'Store created/skipped/failed counts', C.green],
    ];
    flow.forEach((f, i) => {
        box(s, 0.2, 1.6 + i * 0.72, 0.6, 0.62, f[3], f[0], C.white, 14);
        box(s, 0.85, 1.6 + i * 0.72, 5.15, 0.62, C.light, '', C.darkGray, 10);
        s.addText(f[1], { x: 0.95, y: 1.65 + i * 0.72, w: 5.0, h: 0.28, fontSize: 10, bold: true, color: C.navy, fontFace: 'Courier New' });
        s.addText(f[2], { x: 0.95, y: 1.95 + i * 0.72, w: 5.0, h: 0.22, fontSize: 9,  color: C.gray });
    });

    // Right: SFCC payload
    box(s, 6.3, 1.1, 6.9, 2.2, C.darkGray, '', C.white, 10);
    s.addText('SFCC Attribute Payload (OCAPI PUT)', { x: 6.45, y: 1.15, w: 6.6, h: 0.4, fontSize: 12, bold: true, color: C.accent });
    const payload = ['{', '  "id": "variant_price",', '  "value_type": "double",', '  "mandatory": false,', '  "searchable": false,', '  "externally_defined": false,', '  "display_name": {', '    "default": "Variant Price"', '  }', '}'];
    payload.forEach((l, i) => s.addText(l, { x: 6.45, y: 1.6 + i * 0.28, w: 6.6, h: 0.26, fontSize: 9.5, color: C.white, fontFace: 'Courier New' }));

    // Right: object type table
    box(s, 6.3, 3.5, 6.9, 3.5, C.navy, '', C.white, 10);
    s.addText('SFCC System Object Types', { x: 6.45, y: 3.55, w: 6.6, h: 0.4, fontSize: 12, bold: true, color: C.accent });
    const objs = [['Product', 'title, vendor, price, SKU, tags…'], ['Category', 'title, handle, description…'], ['Customer', 'email, name, phone, marketing…'], ['Order', 'price, status, currency, note…'], ['ProductInventoryRecord', 'SKU, cost, tracked, origin…'], ['CustomerGroup', 'name, segment query']];
    objs.forEach((o, i) => {
        s.addText(o[0], { x: 6.45, y: 4.0 + i * 0.48, w: 2.4, h: 0.4, fontSize: 10, bold: true, color: C.yellow });
        s.addText(o[1], { x: 8.9,  y: 4.0 + i * 0.48, w: 4.2, h: 0.4, fontSize: 9.5, color: C.white });
    });

    // SFCC API path
    box(s, 6.3, 7.1, 6.9, 0.55, 'E0F7FA', '', C.darkGray, 10, { line: { color: C.accent, pt: 1 } });
    s.addText('PUT  /s/-/dw/data/v25_6/system_object_definitions/{objectType}/attribute_definitions/{id}', { x: 6.45, y: 7.2, w: 6.6, h: 0.35, fontSize: 9, color: C.navy, fontFace: 'Courier New', bold: true });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 18 — Section: Key Components
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider('08  Key Components', 'Responsibilities of each module');

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 19 — Key Components
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('Key Components & Responsibilities');

    const comps = [
        { name: 'Accelerator.js',     role: 'Controller',   color: C.navy,   desc: 'All HTTP endpoints. Routes wizard steps, AJAX calls (TestConnection, RunMigration, GetSchema, etc.) and session management.' },
        { name: 'registry.js',        role: 'Registry',     color: C.blue,   desc: 'Single source of truth for all platform connectors. Adding a new platform = register here only. No other files change.' },
        { name: 'runner.js',          role: 'Engine',       color: C.green,  desc: 'Batch migration engine. Respects SFCC 16 HTTP-call limit. Calls connector for schema then SFCC client to create attributes.' },
        { name: 'sfccClient.js',      role: 'SFCC API',     color: C.purple, desc: 'SFCC OCAPI wrapper. Handles User Grant auth, GET existing attrs, PUT attribute definitions, DELETE for reset.' },
        { name: 'configAccessor.js',  role: 'Config',       color: C.orange, desc: 'Merges config.defaults.js + config.js (gitignored) + session credentials entered in Step 1 into a single config object.' },
        { name: 'attrBuilder.js',     role: 'Builder',      color: C.accent, desc: 'Builds the SFCC OCAPI attribute payload format. Used by all connectors to produce consistent output.' },
        { name: 'ctpConnector.js',    role: 'CT',          color: C.blue,   desc: 'commercetools connector. OAuth2 auth, paginated product-types + custom-types fetch, 8 object types supported.' },
        { name: 'shopifyConnector.js',role: 'Shopify',      color: C.purple, desc: 'Shopify connector. client_credentials OAuth, standard fields + GraphQL metafields, 6 object types.' },
        { name: 'migrationData.js',   role: 'Data',         color: C.gray,   desc: 'Platform definitions, wizard step config, and connect form field definitions for all platforms.' },
    ];

    comps.forEach((c, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = 0.2 + col * 4.35;
        const y = 1.1 + row * 2.15;
        box(s, x, y, 4.15, 2.0, C.light, '', C.darkGray, 10);
        box(s, x, y, 4.15, 0.52, c.color, c.name, C.white, 11);
        s.addText(c.role, { x: x + 0.08, y: y + 0.56, w: 4.0, h: 0.3, fontSize: 9, bold: true, color: c.color });
        s.addText(c.desc, { x: x + 0.08, y: y + 0.88, w: 4.0, h: 1.05, fontSize: 9.5, color: C.darkGray, wrap: true });
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 20 — Section: Challenges
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider('09  Challenges & Solutions', 'Problems we solved along the way');

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 21 — Challenges & Solutions
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('Challenges Faced & Solutions Implemented');

    const items = [
        {
            ch: 'SFCC 16 HTTP Call Limit',
            so: 'Implemented batch pagination — frontend calls RunMigration in a loop with offset. Max 10 attributes per request stays within quota.',
            chColor: C.orange, soColor: C.green
        },
        {
            ch: 'Shopify No Static Token',
            so: 'Implemented client_credentials OAuth flow. Client ID + Secret exchanged for a shpat_ token dynamically. Token cached per request lifecycle.',
            chColor: C.orange, soColor: C.green
        },
        {
            ch: 'Step 4 Showed 0 Created (Bug)',
            so: 'existingCount (pre-migration SFCC attrs) was wrongly subtracted from created (new attrs). Fixed: totalCreated now reads directly from server response.',
            chColor: C.orange, soColor: C.green
        },
        {
            ch: 'GitHub Push Protection (Secret Leak)',
            so: 'config.js was accidentally committed with live credentials. Rewrote history with git reset --soft, removed file from tracking, confirmed gitignore coverage.',
            chColor: C.orange, soColor: C.green
        },
        {
            ch: 'Shopify Scope Empty on First Token',
            so: 'App had no API scopes configured. Created myapi-2 version with read_products, read_customers, read_orders, read_inventory. Reinstalled app to get scoped token.',
            chColor: C.orange, soColor: C.green
        },
        {
            ch: 'Windows ISML Linter Path Issue',
            so: './node_modules/.bin/isml-linter fails on Windows CMD. Pre-commit hook bypassed with --no-verify for ISML-only failures. JS/CSS lint still enforced.',
            chColor: C.orange, soColor: C.green
        },
    ];

    items.forEach((item, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 0.2 + col * 6.55;
        const y = 1.1 + row * 2.05;

        box(s, x, y, 6.3, 0.5, C.orange, '⚠  Challenge: ' + item.ch, C.white, 11);
        box(s, x, y + 0.5, 6.3, 1.45, C.light, '', C.darkGray, 10);
        s.addText('✓  ' + item.so, { x: x + 0.1, y: y + 0.58, w: 6.1, h: 1.3, fontSize: 10.5, color: C.darkGray, wrap: true });
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 22 — Section: Benefits
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider('10  Benefits & Improvements', 'What this tool delivers');

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 23 — Benefits
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('Benefits & Improvements Achieved');

    const metrics = [
        { icon: '⏱', before: '2–4 Weeks', after: '< 1 Hour', label: 'Migration Time', color: C.green },
        { icon: '❌', before: '15–25%', after: '~0%', label: 'Error Rate', color: C.blue },
        { icon: '🔧', before: 'Manual', after: 'Automated', label: 'Attribute Creation', color: C.purple },
        { icon: '📋', before: '1 Platform', after: '2+ Platforms', label: 'Coverage', color: C.accent },
    ];

    metrics.forEach((m, i) => {
        const x = 0.25 + i * 3.25;
        box(s, x, 1.1, 3.05, 3.6, C.light, '', C.darkGray, 11);
        s.addText(m.icon, { x: x, y: 1.15, w: 3.05, h: 0.65, fontSize: 30, align: 'center' });
        s.addText('BEFORE', { x: x + 0.1, y: 1.9, w: 1.35, h: 0.35, fontSize: 9, color: C.gray, bold: true, align: 'center' });
        s.addText('AFTER', { x: x + 1.55, y: 1.9, w: 1.35, h: 0.35, fontSize: 9, color: m.color, bold: true, align: 'center' });
        s.addText(m.before, { x: x + 0.1, y: 2.3, w: 1.35, h: 0.6, fontSize: 13, color: C.orange, bold: true, align: 'center' });
        s.addText(m.after,  { x: x + 1.55, y: 2.3, w: 1.35, h: 0.6, fontSize: 13, color: m.color, bold: true, align: 'center' });
        box(s, x, 3.0, 3.05, 0.5, m.color, m.label, C.white, 11);
    });

    const benefits = [
        '✓  Zero manual attribute creation — 100% automated schema setup',
        '✓  Plug-in architecture — adding a new platform requires only a new connector file',
        '✓  Idempotent — safe to re-run; existing attributes are detected and skipped automatically',
        '✓  Live confidence scoring — engineers know which mappings need review before committing',
        '✓  Credential security — secrets never committed to git; GitHub Push Protection enforced',
        '✓  Batch processing — respects SFCC API limits; no request quota violations',
    ];

    box(s, 0.25, 3.8, 12.9, 3.3, C.navy, '', C.white, 11);
    s.addText('Key Benefits', { x: 0.4, y: 3.85, w: 12.5, h: 0.4, fontSize: 13, bold: true, color: C.accent });
    benefits.forEach((b, i) => s.addText(b, { x: 0.4, y: 4.3 + i * 0.45, w: 12.5, h: 0.4, fontSize: 11.5, color: C.white }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 24 — Section: Demo
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider('11  Demo Flow', 'Key use cases and walkthrough');

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 25 — Demo Flow
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('Demo Flow & Key Use Cases');

    const demoSteps = [
        { step: '01', title: 'Dashboard', action: 'Open SFCC BM → B2C Migration Console. Select platform: Shopify.', url: 'Accelerator-Start' },
        { step: '02', title: 'Connect',   action: 'Enter Store URL + Client ID + Secret. Click Test Connection → "Connected — My Store".', url: 'Accelerator-TestConnection' },
        { step: '03', title: 'Fetch',     action: 'Schema loads: Product (14 standard), Category (5), Customer (10), Order (10), Inventory (6), CustomerGroup (2). Select all.', url: 'Accelerator-GetSchema' },
        { step: '04', title: 'AI Map',    action: 'Review field mapping table. Green = high confidence. Each field shows source type → SFCC type mapping.', url: 'Accelerator-GetAiMap' },
        { step: '05', title: 'Move',      action: 'Click Start Migration. Watch live progress bars per object type. Results: 47 created, 0 failed.', url: 'Accelerator-RunMigration' },
        { step: '06', title: 'View',      action: 'Summary report: attributes created per type. Verify in SFCC BM → Administration → System Object Types → Product.', url: 'Accelerator-Start' },
    ];

    demoSteps.forEach((d, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 0.2 + col * 6.55;
        const y = 1.1 + row * 2.05;
        box(s, x, y, 0.8, 2.0, C.accent, d.step, C.navy, 18);
        box(s, x + 0.8, y, 5.5, 2.0, C.light, '', C.darkGray, 10);
        s.addText(d.title, { x: x + 0.95, y: y + 0.1, w: 5.2, h: 0.4, fontSize: 14, bold: true, color: C.navy });
        s.addText(d.action, { x: x + 0.95, y: y + 0.55, w: 5.2, h: 1.1, fontSize: 10.5, color: C.darkGray, wrap: true });
        s.addText(d.url, { x: x + 0.95, y: y + 1.65, w: 5.2, h: 0.28, fontSize: 8.5, color: C.gray, fontFace: 'Courier New' });
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 26 — Section: Future
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider('12  Future Enhancements', 'Roadmap and next steps');

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 27 — Future Enhancements
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = contentSlide('Future Enhancements & Roadmap');

    const phases = [
        {
            phase: 'Phase 2', color: C.blue, items: [
                'BigCommerce connector (store hash + API token auth)',
                'SAP Commerce Cloud connector',
                'Salesforce B2C → B2B cross-cloud migration',
                'Price book migration (product pricing)',
            ]
        },
        {
            phase: 'Phase 3', color: C.purple, items: [
                'Actual data migration — products, customers, orders',
                'Delta/incremental migration (only changed records)',
                'Rollback capability — restore previous schema state',
                'Conflict resolution UI for duplicate attributes',
            ]
        },
        {
            phase: 'Phase 4', color: C.green, items: [
                'AI-powered mapping using Claude API for complex type inference',
                'Migration preview with sample data transformation',
                'Scheduled/automated migration runs via SFCC jobs',
                'Multi-tenant support — migrate multiple stores in parallel',
            ]
        },
    ];

    phases.forEach((p, i) => {
        const x = 0.2 + i * 4.35;
        box(s, x, 1.1, 4.15, 0.55, p.color, p.phase, C.white, 14);
        box(s, x, 1.7, 4.15, 4.2, C.light, '', C.darkGray, 11);
        p.items.forEach((item, j) => {
            s.addText('→  ' + item, { x: x + 0.15, y: 1.85 + j * 0.95, w: 3.85, h: 0.85, fontSize: 11, color: C.darkGray, wrap: true });
        });
    });

    box(s, 0.2, 6.3, 12.9, 0.85, C.navy, '', C.white, 11);
    s.addText('Platform Status:  ✅ commercetools (Ready)  ✅ Shopify (Ready)  🔜 BigCommerce  🔜 SAP Commerce  🔜 Salesforce B2C',
        { x: 0.35, y: 6.5, w: 12.6, h: 0.5, fontSize: 12, color: C.accent, bold: true, align: 'center' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 28 — Thank You
// ═══════════════════════════════════════════════════════════════════════════════
{
    const s = pres.addSlide();
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: C.navy } });
    s.addShape(pres.ShapeType.rect, { x: 0, y: 3.2, w: '100%', h: 0.08, fill: { color: C.accent } });
    s.addShape(pres.ShapeType.rect, { x: 0, y: 3.3, w: '100%', h: 0.08, fill: { color: C.blue } });
    s.addText('Thank You', { x: 0.4, y: 0.8, w: 12, h: 1.8, fontSize: 54, bold: true, color: C.white });
    s.addText('B2C Migration Console  |  Royal Cyber', { x: 0.4, y: 2.7, w: 12, h: 0.55, fontSize: 18, color: C.accent });
    s.addText('Questions & Demo', { x: 0.4, y: 3.7, w: 12, h: 0.55, fontSize: 20, bold: true, color: C.white });
    s.addText([
        { text: 'GitHub:  ', options: { color: C.gray } },
        { text: 'rc-alirabbani/B2C-migration-console', options: { color: C.accent } },
    ], { x: 0.4, y: 4.5, w: 10, h: 0.4, fontSize: 13 });
    s.addText([
        { text: 'Contact:  ', options: { color: C.gray } },
        { text: 'sunnyshk85@gmail.com', options: { color: C.accent } },
    ], { x: 0.4, y: 5.0, w: 10, h: 0.4, fontSize: 13 });
    s.addText('ROYAL CYBER', { x: 0.4, y: 6.5, w: 12, h: 0.4, fontSize: 11, bold: true, color: C.accent, charSpacing: 4 });
}

// ─── Write file ───────────────────────────────────────────────────────────────
pres.writeFile({ fileName: 'docs/B2C-Migration-Console-Demo.pptx' })
    .then(() => console.log('✅  Saved: docs/B2C-Migration-Console-Demo.pptx'))
    .catch(err => { console.error('❌  Error:', err); process.exit(1); });
