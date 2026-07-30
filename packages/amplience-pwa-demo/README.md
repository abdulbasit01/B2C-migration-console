# Amplience PWA Kit demo (drop-in)

Copy these files into your **Retail React App** to try live Amplience rendering and Headless Page Designer components.

## 1. Install packages

```bash
npm install /path/to/B2C-migrationConsole/packages/amplience-core
npm install /path/to/B2C-migrationConsole/packages/amplience-react
```

## 2. Copy drop-in files

| From | To (in your PWA Kit app) |
|------|--------------------------|
| `drop-in/app/pages/amplience-demo/` | `app/pages/amplience-demo/` |
| `drop-in/app/page-designer/amplience-components.js` | merge into your PD registry |

## 3. Import styles

In `app/main.jsx` (or your app entry):

```javascript
import '@royalcyber/amplience-react/src/styles/amplienceContent.css';
import './pages/amplience-demo/amplience-demo.scss';
```

## 4. Register route

In `app/routes.jsx`:

```javascript
import AmplienceDemoPage from './pages/amplience-demo';

// add to routes array:
{ path: '/amplience-demo', component: AmplienceDemoPage }
```

## 5. Environment

Add to `.env` or PWA Kit config:

```
AMPLIENCE_HUB_NAME=your-amplience-hub
```

## 6. Run

```bash
npm start
```

Open:

```
http://localhost:3000/amplience-demo
http://localhost:3000/amplience-demo?hub=your-hub&keys=hero,header/promo
```

## Headless Page Designer

After deploying `app_custom_cms` and `bm_accelerator` to SFCC:

1. Create a headless page in BM (Home or Store Page)
2. Add **Amplience Content Widget** with `hubName` + `deliveryKey`
3. Register PD components via `drop-in/app/page-designer/amplience-components.js`
4. Open `/page/home` (or your configured page route) in the React app
