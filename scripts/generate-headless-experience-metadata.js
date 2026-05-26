/**
 * Copies experience/*.json from app_storefront_base and adds Composable Storefront
 * headless fields. PDP/PLP attribute IDs and routes align with default Retail React App
 * (/product/:productId, /category/:categoryId).
 * Storefront pages (storePage): /page/:pageId — matches Retail React App page viewer route.
 *
 * Run from repo root: node scripts/generate-headless-experience-metadata.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'cartridges/app_storefront_base/cartridge/experience')
const DEST = path.join(ROOT, 'cartridges/app_custom_headless/cartridge/experience')

function walkJson(dir, acc = []) {
    for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, ent.name)
        if (ent.isDirectory()) walkJson(p, acc)
        else if (ent.name.endsWith('.json')) acc.push(p)
    }
    return acc
}

function relExperience(fullPath) {
    return path.relative(SRC, fullPath).replace(/\\/g, '/')
}

/** Align PDP/PLP with Retail React App route param names (productId, categoryId). */
function alignComposableRetail(relPath, data) {
    const out = JSON.parse(JSON.stringify(data))

    if (relPath === 'pages/productDetail.json') {
        out.route = '/product/:productId'
        const attr = out.attribute_definition_groups?.[0]?.attribute_definitions?.[0]
        if (attr && attr.id === 'product') {
            attr.id = 'productId'
            attr.dynamic_lookup = {aspect_attribute_alias: 'productId'}
        }
    }

    if (relPath === 'pages/productList.json') {
        out.route = '/category/:categoryId'
        const attr = out.attribute_definition_groups?.[0]?.attribute_definitions?.[0]
        if (attr && attr.id === 'category') {
            attr.id = 'categoryId'
            attr.dynamic_lookup = {aspect_attribute_alias: 'categoryId'}
        }
    }

    if (relPath === 'aspects/pdp.json') {
        const attr = out.attribute_definitions?.[0]
        if (attr && attr.id === 'product') {
            attr.id = 'productId'
        }
    }

    if (relPath === 'aspects/plp.json') {
        const attr = out.attribute_definitions?.[0]
        if (attr && attr.id === 'category') {
            attr.id = 'categoryId'
        }
    }

    if (relPath === 'components/dynamic/productDetail.json') {
        const attr = out.attribute_definition_groups?.[0]?.attribute_definitions?.[0]
        if (attr && attr.id === 'product') {
            attr.id = 'productId'
            attr.dynamic_lookup = {aspect_attribute_alias: 'productId'}
        }
    }

    if (relPath === 'components/dynamic/productList.json') {
        const attr = out.attribute_definition_groups?.[0]?.attribute_definitions?.[0]
        if (attr && attr.id === 'category') {
            attr.id = 'categoryId'
            attr.dynamic_lookup = {aspect_attribute_alias: 'categoryId'}
        }
    }

    if (relPath === 'components/dynamic/dynamicCategoryBanner.json') {
        const defs = out.attribute_definition_groups?.[0]?.attribute_definitions
        if (Array.isArray(defs)) {
            defs.forEach((attr) => {
                if (attr.id === 'category') {
                    attr.id = 'categoryId'
                    attr.dynamic_lookup = {aspect_attribute_alias: 'categoryId'}
                }
                if (attr.id === 'product') {
                    attr.id = 'productId'
                    attr.dynamic_lookup = {aspect_attribute_alias: 'productId'}
                }
            })
        }
    }

    return out
}

function transform(relPath, data) {
    if (relPath === 'breakpoints.json') {
        return data
    }

    let merged = {...data, arch_type: 'headless'}

    if (relPath === 'pages/storePage.json') {
        merged.route = '/page/:pageId'
    }

    merged = alignComposableRetail(relPath, merged)

    if (relPath === 'pages/productDetail.json' && !merged.route) {
        merged.route = '/product/:productId'
    }
    if (relPath === 'pages/productList.json' && !merged.route) {
        merged.route = '/category/:categoryId'
    }

    return merged
}

function main() {
    fs.mkdirSync(DEST, {recursive: true})
    const files = walkJson(SRC)

    for (const file of files) {
        const rel = relExperience(file)
        const raw = fs.readFileSync(file, 'utf8')
        const data = JSON.parse(raw)
        const next = transform(rel, data)
        const target = path.join(DEST, rel)
        fs.mkdirSync(path.dirname(target), {recursive: true})
        fs.writeFileSync(target, JSON.stringify(next, null, 4) + '\n', 'utf8')
        console.log('wrote', target)
    }
}

main()
