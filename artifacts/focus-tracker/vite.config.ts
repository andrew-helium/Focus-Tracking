import fs from 'fs';
import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const rawPort = process.env.PORT ?? '19264';

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? (process.env.NODE_ENV === 'production' ? './' : '/');

// Chrome treats a crossorigin stylesheet as a CORS fetch, then refuses the
// @font-face files because extension responses have no CORS header. The page
// keeps its layout and falls back to the system serif and sans.
function oauthClientManifest() {
  const root = path.resolve(import.meta.dirname);
  const files = [path.join(root, 'public', 'manifest.json'), path.join(root, 'dist', 'public', 'manifest.json')];
  return {
    name: 'oauth-client-manifest',
    configureServer(server: { middlewares: { use: (route: string, handler: (req: any, res: any) => void) => void } }) {
      server.middlewares.use('/__focus-oauth-client', (req, res) => {
        const origin = String(req.headers.origin || '');
        const allowed = origin.startsWith('chrome-extension://');
        if (allowed) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.setHeader('Access-Control-Allow-Private-Network', 'true');
        }
        if (req.method === 'OPTIONS') {
          res.statusCode = allowed ? 204 : 403;
          res.end();
          return;
        }
        if (req.method !== 'POST' || !allowed) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const clientId = Buffer.concat(chunks).toString('utf8').trim();
          if (!/^[A-Za-z0-9-]{8,}\.apps\.googleusercontent\.com$/.test(clientId)) {
            res.statusCode = 400;
            res.end('Invalid client ID');
            return;
          }
          try {
            for (const file of files) {
              if (!fs.existsSync(file)) continue;
              const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as { permissions?: string[]; oauth2?: { client_id: string; scopes: string[] } };
              const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
              if (!permissions.includes('identity')) permissions.push('identity');
              manifest.permissions = permissions;
              manifest.oauth2 = { client_id: clientId, scopes: ['https://www.googleapis.com/auth/drive.file'] };
              fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
            }
            res.statusCode = 204;
            res.end();
          } catch (error) {
            res.statusCode = 500;
            res.end(error instanceof Error ? error.message : 'Could not save client ID');
          }
        });
      });
    },
  };
}

function extensionStylesheet() {
  return {
    name: 'extension-stylesheet',
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string) {
        return html.replaceAll('<link rel="stylesheet" crossorigin ', '<link rel="stylesheet" ');
      },
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    extensionStylesheet(),
    oauthClientManifest(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
