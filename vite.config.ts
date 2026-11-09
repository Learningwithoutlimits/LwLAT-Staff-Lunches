import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const page = (name: string) => resolve(import.meta.dirname, `${name}.html`);

// The login page loads before sign-in, so its JS + CSS go in /signin-assets (left open by the edge gate).
// Everything else goes in /app, which stays behind the gate.
const isLogin = (names: readonly string[] = []) => names.some(n => n === 'login' || n.startsWith('login.'));
const dir = (names?: readonly string[]) => isLogin(names) ? 'signin-assets' : 'app';

// /admin, /login and /signed-out, like the Netlify redirects in netlify.toml (for `npm run demo` and `npm run local`)
const prettyUrls: Plugin = {
  name: 'pretty-urls',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      req.url = req.url?.replace(/^\/(admin|login)(?=$|\?)/, '/$1.html').replace(/^\/signed-out(?=$|\?)/, '/login.html');
      next();
    });
  },
};

// `npm run local`: the real API (netlify/functions/api.mts) on the dev server, signed in as AUTH_DEV_EMAIL.
// Uses the same AUTH_DEV_EMAIL bypass as `netlify dev` (CONTEXT=dev), with an in-memory store seeded with demo data.
// Dev server only: nothing here reaches `vite build` or a deployed site.
const localApi: Plugin = {
  name: 'local-api',
  apply: 'serve',
  configureServer(server) {
    const email = process.env.AUTH_DEV_EMAIL || 'alex.taylor@lwlat.org.uk';
    Object.assign(process.env, {
      CONTEXT: 'dev', AUTH_DEV_EMAIL: email, AUTH_DEV_NAME: process.env.AUTH_DEV_NAME || 'Alex Taylor',
      ADMIN_EMAILS: process.env.ADMIN_EMAILS || email, SEED_DEMO: process.env.SEED_DEMO ?? 'true',
    });
    server.middlewares.use(async (req, res, next) => {
      const path = req.url ?? '/';
      // No Microsoft round trip: sign-in goes straight back, sign-out lands on the signed-out page
      if (path.startsWith('/auth/')) {
        const url = new URL(path, 'http://x');
        const back = url.pathname === '/auth/logout' ? '/signed-out' : url.searchParams.get('returnTo') || '/';
        res.writeHead(302, { Location: back.startsWith('/') && !back.startsWith('//') ? back : '/' }).end();
        return;
      }
      if (!path.startsWith('/api/')) return next();
      try {
        globalThis.__APP_TEST_STORE__ ??= (await server.ssrLoadModule('/tests/memory-store.mts')).memoryStore();
        const api = (await server.ssrLoadModule('/netlify/functions/api.mts')).default as (r: Request) => Promise<Response>;
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const r = await api(new Request(`http://${req.headers.host}${path}`, {
          method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
        }));
        res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
      } catch (e) { next(e); }
    });
  },
};

export default defineConfig(({ mode }) => ({
  appType: 'mpa',
  plugins: [prettyUrls, ...(mode === 'localapi' ? [localApi] : [])],
  build: {
    outDir: 'dist',
    sourcemap: false,
    modulePreload: { polyfill: false }, // the polyfill would be a shared chunk outside /signin-assets
    rolldownOptions: {
      input: { index: page('index'), admin: page('admin'), login: page('login') },
      output: {
        entryFileNames: c => `${dir([c.name])}/[name]-[hash].js`,
        chunkFileNames: 'app/[name]-[hash].js',
        assetFileNames: a => `${dir(a.names)}/[name]-[hash][extname]`,
      },
    },
  },
}));
