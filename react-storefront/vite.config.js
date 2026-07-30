import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const { createAmpliencePreviewMiddleware } = require('./amplience-preview-middleware.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function resolveSfccStorefront(env) {
    const explicit = (env.VITE_SFCC_STOREFRONT_URL || env.SFCC_STOREFRONT_URL || '').trim();
    if (explicit) {
        const url = new URL(explicit);
        return {
            storefrontUrl: explicit.replace(/\/$/, ''),
            proxyTarget: url.origin,
            proxyPathPrefix: url.pathname.replace(/\/$/, '')
        };
    }

    const dwPath = path.join(ROOT, 'dw.json');
    if (!fs.existsSync(dwPath)) {
        return { storefrontUrl: '', proxyTarget: '', proxyPathPrefix: '' };
    }

    const dw = JSON.parse(fs.readFileSync(dwPath, 'utf8'));
    const hostname = String(dw.hostname || '').trim();
    if (!hostname) {
        return { storefrontUrl: '', proxyTarget: '', proxyPathPrefix: '' };
    }

    const siteId = env.SFCC_SITE_ID || env.VITE_SFCC_SITE_ID || 'MigrationConsole';
    const locale = env.SFCC_LOCALE || env.VITE_SFCC_LOCALE || 'en_US';
    const storePath = '/on/demandware.store/Sites-' + siteId + '-Site/' + locale;

    return {
        storefrontUrl: 'https://' + hostname + storePath,
        proxyTarget: 'https://' + hostname,
        proxyPathPrefix: storePath
    };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, ROOT, '');
    const sfcc = resolveSfccStorefront(env);
    const sfccConfigured = !!sfcc.storefrontUrl;

    return {
        plugins: [
            react({ include: /\.(jsx|js|tsx|ts)$/ }),
            {
                name: 'amplience-preview-api',
                configureServer(server) {
                    server.middlewares.use(createAmpliencePreviewMiddleware(env));
                }
            }
        ],
        resolve: {
            alias: {
                '@royalcyber/amplience-core': path.resolve(__dirname, '../packages/amplience-core/esm/index.js'),
                '@royalcyber/amplience-react': path.resolve(__dirname, '../packages/amplience-react/src')
            }
        },
        server: {
            port: 3001,
            strictPort: true,
            open: '/amplience-gallery',
            proxy: sfcc.proxyTarget ? {
                '/sfcc-api': {
                    target: sfcc.proxyTarget,
                    changeOrigin: true,
                    secure: true,
                    rewrite: function (proxyPath) {
                        return proxyPath.replace(/^\/sfcc-api/, sfcc.proxyPathPrefix || '');
                    }
                }
            } : undefined
        },
        define: {
            'import.meta.env.VITE_AMPLIENCE_HUB_NAME': JSON.stringify(
                env.VITE_AMPLIENCE_HUB_NAME || env.AMPLIENCE_HUB_NAME || 'royalcyber'
            ),
            'import.meta.env.VITE_AMPLIENCE_DEFAULT_CONTENT_ID': JSON.stringify(
                env.VITE_AMPLIENCE_DEFAULT_CONTENT_ID || env.AMPLIENCE_DEFAULT_CONTENT_ID
                    || 'ba65f899-6545-4a21-8f09-00387d3a4b7d'
            ),
            'import.meta.env.VITE_AMPLIENCE_DEFAULT_RICH_TEXT_ID': JSON.stringify(
                env.VITE_AMPLIENCE_DEFAULT_RICH_TEXT_ID || env.AMPLIENCE_DEFAULT_RICH_TEXT_ID
                    || '4d2bf3b9-91ea-4d06-84a5-d3c826bbac0a'
            ),
            'import.meta.env.VITE_AMPLIENCE_CATALOG_IDS': JSON.stringify(
                env.VITE_AMPLIENCE_CATALOG_IDS || env.AMPLIENCE_CATALOG_IDS
                    || 'ba65f899-6545-4a21-8f09-00387d3a4b7d,4d2bf3b9-91ea-4d06-84a5-d3c826bbac0a'
            ),
            'import.meta.env.VITE_SFCC_STOREFRONT_URL': JSON.stringify(sfcc.storefrontUrl),
            'import.meta.env.VITE_SFCC_STOREFRONT_CONFIGURED': JSON.stringify(sfccConfigured)
        }
    };
});
