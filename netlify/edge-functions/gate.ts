// Locks every page and API route behind a valid session. Unsigned visitors are sent
// through Microsoft silent SSO first; if that can't sign them in they land on /login.
import { verifyToken, getCookie, SESSION_COOKIE } from '../lib/session.mts';

declare const Netlify: { env: { get(key: string): string | undefined } };

// Vite dev-server modules, so the login page can load under `netlify dev` before sign-in
const DEV_PATHS = /^\/(@vite|@id|@fs|src|shared|node_modules)\//;

export default async (req: Request, context: { next(): Promise<Response> | Response }) => {
  const env = (k: string) => Netlify.env.get(k);
  const url = new URL(req.url);
  if (env('CONTEXT') === 'dev' && (env('AUTH_DEV_EMAIL') || DEV_PATHS.test(url.pathname))) return context.next(); // local `netlify dev` only

  // Fails closed: with no SESSION_SECRET, verifyToken returns null and nobody gets past the gate
  if (await verifyToken(getCookie(req, SESSION_COOKIE), env('SESSION_SECRET'))) return context.next();

  if (url.pathname.startsWith('/api/'))
    return new Response(JSON.stringify({ error: 'Not signed in' }), { status: 401, headers: { 'content-type': 'application/json' } });
  const returnTo = url.pathname + url.search;
  return Response.redirect(new URL(`/auth/login?silent=1&returnTo=${encodeURIComponent(returnTo)}`, url), 302);
};

// /signin-assets holds only the login page's JS + CSS (see vite.config.ts); register and admin code stays behind the gate.
export const config = {
  path: '/*',
  // /signed-out is the login page with a "You've signed out" message (netlify.toml); /apple-touch-icon.png is the home-screen icon; /robots.txt tells crawlers to stay out.
  // /assets/* holds only logos, the favicon and theme-boot.js. Never put sensitive files there.
  excludedPath: ['/login', '/login.html', '/signed-out', '/auth/*', '/assets/*', '/signin-assets/*', '/favicon.svg', '/apple-touch-icon.png', '/robots.txt', '/.netlify/*'],
};
