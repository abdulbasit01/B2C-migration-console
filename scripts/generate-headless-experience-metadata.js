/**
 * Generates app_custom_headless experience metadata for Composable Storefront.
 *
 * 1. Copies experience/*.json from app_storefront_base and adds headless fields.
 * 2. Overlays bm_accelerator experience metadata (Amplience widget, home page, etc.).
 *
 * PDP/PLP routes align with Retail React App (/product/:productId, /category/:categoryId).
 * Storefront pages: /page/:pageId
 *
 * Run from repo root: npm run generate:headless
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'cartridges/app_storefront_base/cartridge/experience');
const OVERLAY = path.join(ROOT, 'cartridges/bm_accelerator/cartridge/experience');
const DEST = path.join(ROOT, 'cartridges/app_custom_headless/cartridge/experience');

function walkJson(dir, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walkJson(p, acc);
        else if (ent.name.endsWith('.json')) acc.push(p);
    }
    return acc;
}

function relExperience(fullPath, baseDir) {
    return path.relative(baseDir, fullPath).replace(/\\/g, '/');
}

function alignComposableRetail(relPath, data) {
    const out = JSON.parse(JSON.stringify(data));

    if (relPath === 'pages/productDetail.json') {
        out.route = '/product/:productId';
        const attr = out.attribute_definition_groups?.[0]?.attribute_definitions?.[0];
        if (attr && attr.id === 'product') {
            attr.id = 'productId';
            attr.dynamic_lookup = { aspect_attribute_alias: 'productId' };
        }
    }

    if (relPath === 'pages/productList.json') {
        out.route = '/category/:categoryId';
        const attr = out.attribute_definition_groups?.[0]?.attribute_definitions?.[0];
        if (attr && attr.id === 'category') {
            attr.id = 'categoryId';
            attr.dynamic_lookup = { aspect_attribute_alias: 'categoryId' };
        }
    }

    if (relPath === 'aspects/pdp.json') {
        const attr = out.attribute_definitions?.[0];
        if (attr && attr.id === 'product') {
            attr.id = 'productId';
        }
    }

    if (relPath === 'aspects/plp.json') {
        const attr = out.attribute_definitions?.[0];
        if (attr && attr.id === 'category') {
            attr.id = 'categoryId';
        }
    }

    if (relPath === 'components/dynamic/productDetail.json') {
        const attr = out.attribute_definition_groups?.[0]?.attribute_definitions?.[0];
        if (attr && attr.id === 'product') {
            attr.id = 'productId';
            attr.dynamic_lookup = { aspect_attribute_alias: 'productId' };
        }
    }

    if (relPath === 'components/dynamic/productList.json') {
        const attr = out.attribute_definition_groups?.[0]?.attribute_definitions?.[0];
        if (attr && attr.id === 'category') {
            attr.id = 'categoryId';
            attr.dynamic_lookup = { aspect_attribute_alias: 'categoryId' };
        }
    }

    if (relPath === 'components/dynamic/dynamicCategoryBanner.json') {
        const defs = out.attribute_definition_groups?.[0]?.attribute_definitions;
        if (Array.isArray(defs)) {
            defs.forEach((attr) => {
                if (attr.id === 'category') {
                    attr.id = 'categoryId';
                    attr.dynamic_lookup = { aspect_attribute_alias: 'categoryId' };
                }
                if (attr.id === 'product') {
                    attr.id = 'productId';
                    attr.dynamic_lookup = { aspect_attribute_alias: 'productId' };
                }
            });
        }
    }

    return out;
}

function normalizeRoute(route) {
    if (!route || typeof route !== 'string') return route;
    if (route.indexOf('/') === 0) return route;
    return '/' + route;
}

function transformBase(relPath, data) {
    if (relPath === 'breakpoints.json') {
        return data;
    }

    let merged = { ...data, arch_type: 'headless' };

    if (relPath === 'pages/storePage.json') {
        merged.route = '/page/:pageId';
    }

    merged = alignComposableRetail(relPath, merged);

    if (relPath === 'pages/productDetail.json' && !merged.route) {
        merged.route = '/product/:productId';
    }
    if (relPath === 'pages/productList.json' && !merged.route) {
        merged.route = '/category/:categoryId';
    }

    return merged;
}

function transformOverlay(relPath, data) {
    let merged = { ...data, arch_type: 'headless' };

    if (relPath === 'pages/storePage.json') {
        merged.route = '/page/:pageId';
    } else if (relPath === 'pages/home.json') {
        merged.route = '/page/home';
    } else if (merged.route) {
        merged.route = normalizeRoute(merged.route);
    }

    merged = alignComposableRetail(relPath, merged);
    return merged;
}

function writeExperienceFile(relPath, data) {
    const target = path.join(DEST, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(data, null, 4) + '\n', 'utf8');
    console.log('wrote', target);
}

function generateFromSource(sourceDir, transformFn) {
    const files = walkJson(sourceDir);
    files.forEach((file) => {
        const rel = relExperience(file, sourceDir);
        const raw = fs.readFileSync(file, 'utf8');
        const data = JSON.parse(raw);
        const next = transformFn(rel, data);
        writeExperienceFile(rel, next);
    });
}

function main() {
    fs.mkdirSync(DEST, { recursive: true });
    generateFromSource(SRC, transformBase);
    generateFromSource(OVERLAY, transformOverlay);
}

main();
