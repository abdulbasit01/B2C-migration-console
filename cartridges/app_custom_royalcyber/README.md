# Royal Cyber SFRA Theme (`app_custom_royalcyber`)

SFRA (not PWA Kit) branding overlay for the storefront.

## Palette

| Token | Hex | Use |
|-------|-----|-----|
| Navy | `#002b5c` | Logo brand, headings, footer |
| Mid navy | `#004a82` | Secondary |
| Orange | `#f58220` | Primary CTA / accent |

## Cartridge path (RefArch Settings)

```text
app_custom_royalcyber:app_custom_amplience:app_storefront_base:modules
```

`app_custom_royalcyber` must be **left of** `app_storefront_base` so template/CSS overrides win.

## Upload

```bash
npm run upload:royalcyber
```

## Why Home-Show ignored the new blocks (important)

SFRA `Home-Show` / `Default-Start` do this:

```js
var page = PageMgr.getPage('homepage');
if (page && page.isVisible()) {
    res.page('homepage');   // Page Designer — skips home/homePage.isml
} else {
    res.render('home/homePage');
}
```

If Merchant Tools → Page Designer has a visible page with ID **`homepage`**, your ISML hero/categories never render. Product pages still pick up `royalCyber.css` from `htmlHead`, which is why Product-Show looked themed but Home did not.

**Fix in this cartridge:** `controllers/Home.js` and `controllers/Default.js` always `res.render('home/homePage')`.

**Optional BM alternative:** unpublish or rename the PD page ID `homepage`.

## What’s included

- `static/default/css/royalCyber.css` — site skin + home styles
- `static/default/images/Royal-Cyber-Logo.png` + hero/category images
- Overrides: `htmlHead.isml`, `pageHeader.isml`, `pageFooter.isml`, `home/homePage.isml`
- Controllers: `Home.js`, `Default.js` (force SFRA home template)

## Home layout

1. Branded hero (eyebrow + headline + Shop Collections)
2. Shop by category (4 tiles)
3. Shop Products (existing `home-products-m` slot)
4. Email signup (navy footer band)
