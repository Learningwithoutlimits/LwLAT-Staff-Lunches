// Signed session cookies using Web Crypto (HMAC-SHA256).
// Works in both Netlify Functions (Node) and Edge Functions (Deno) — no dependencies.
const enc = new TextEncoder(), dec = new TextDecoder();

// Change "app" to a short code for the new app (e.g. 'fr' for the fob register, 'nst' for the starter tracker).
export const APP_CODE = 'sfl';
export const SESSION_COOKIE = `${APP_CODE}_session`;
export const OIDC_COOKIE = `${APP_CODE}_oidc`;
export const SESSION_HOURS = Math.min(12, Math.max(1, Number(globalThis.process?.env?.SESSION_HOURS) || 8)); // standard: 8 hours (SESSION_HOURS, 1–12)

/** What's inside the session cookie. */
export interface Session { email: string; name: string; oid?: string; groups?: string[]; exp: number }

/** "View as": an admin seeing the app as someone else. Only honoured while `by` is still an admin. */
export const VIEWAS_COOKIE = `${APP_CODE}_viewas`;
export const VIEWAS_MINUTES = 60;
export interface ViewAs { email: string; name: string; groups: string[]; by: string; exp: number }

export const b64u = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64u = (s: string) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
export const randomToken = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
export const sha256b64u = async (s: string) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));
export const decodeJwtPayload = (jwt: string): Record<string, any> => JSON.parse(dec.decode(fromB64u(String(jwt).split('.')[1] || '')));

const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string) {
  if (!keyCache.has(secret)) keyCache.set(secret, crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
  return keyCache.get(secret)!;
}

export async function signToken<T extends { exp: number }>(payload: T, secret: string | undefined) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters)');
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64u(sig)}`;
}

export async function verifyToken<T extends { exp: number } = Session>(token: string | null, secret: string | undefined): Promise<T | null> {
  if (!token || !secret) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64u(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(dec.decode(fromB64u(body)));
    if (!p.exp || p.exp * 1000 < Date.now()) return null;
    return p;
  } catch { return null; }
}

export function getCookie(req: Request, name: string) {
  for (const part of (req.headers.get('cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export const cookie = (name: string, value: string, { maxAge, path = '/' }: { maxAge?: number; path?: string } = {}) =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; Secure; SameSite=Lax${maxAge != null ? `; Max-Age=${maxAge}` : ''}`;
