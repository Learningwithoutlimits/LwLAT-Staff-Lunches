// Microsoft Entra ID sign-in (OpenID Connect authorisation code flow + PKCE, confidential client).
//   /auth/login?returnTo=/x[&silent=1]  -> redirect to Microsoft (silent = prompt=none, for automatic SSO)
//   /auth/callback                       -> exchange code, check identity + access, set session cookie
//   /auth/logout                         -> clear session and sign out of Microsoft
import { signToken, verifyToken, getCookie, cookie, randomToken, sha256b64u, decodeJwtPayload,
         SESSION_COOKIE, OIDC_COOKIE, SESSION_HOURS, VIEWAS_COOKIE } from '../lib/session.mts';
import type { User } from '../lib/auth.mts';
import { store, recordSignIn, enrolPerson } from '../lib/store.mts';

// Sign-in is open to anyone, so cap it per IP (high enough for a school's staff all arriving at 8am)
export const config = { path: '/auth/*', rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] } };

/** Short-lived state kept in the OIDC cookie between /auth/login and /auth/callback. */
interface OidcTx { state: string; nonce: string; verifier: string; returnTo: string; silent: boolean; exp: number }

const SILENT_FAIL = new Set(['login_required', 'interaction_required', 'consent_required', 'account_selection_required']);
const safeReturn = (r: string | null) => (typeof r === 'string' && /^\/(?!\/)/.test(r) && !r.startsWith('/auth/') && !r.startsWith('/login')) ? r : '/';
const redirect = (location: string, cookies: string[] = []) => {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  cookies.forEach(c => h.append('Set-Cookie', c));
  return new Response(null, { status: 302, headers: h });
};
const toLogin = (q: Record<string, string>, cookies: string[]) => redirect(`/login?${new URLSearchParams(q)}`, cookies);

export default async (req: Request) => {
  const { ENTRA_TENANT_ID: tenant, ENTRA_CLIENT_ID: clientId, ENTRA_CLIENT_SECRET: clientSecret, SESSION_SECRET: secret } = process.env;
  const url = new URL(req.url);
  const base = (process.env.APP_URL || url.origin).replace(/\/$/, '');
  const redirectUri = `${base}/auth/callback`;
  const route = url.pathname.replace(/^\/auth\/?/, '');
  const authority = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  if (!tenant || !clientId || !clientSecret || !secret)
    return new Response('Sign-in is not configured: set ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET and SESSION_SECRET.', { status: 500 });

  if (route === 'login') {
    const silent = url.searchParams.get('silent') === '1';
    const returnTo = safeReturn(url.searchParams.get('returnTo'));
    const state = randomToken(16), nonce = randomToken(16), verifier = randomToken(32);
    const p = new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query',
      scope: 'openid profile email', state, nonce, code_challenge: await sha256b64u(verifier), code_challenge_method: 'S256',
      prompt: silent ? 'none' : 'select_account',
    });
    if (process.env.ENTRA_DOMAIN_HINT) p.set('domain_hint', process.env.ENTRA_DOMAIN_HINT);
    const tx = await signToken({ state, nonce, verifier, returnTo, silent, exp: Math.floor(Date.now() / 1000) + 600 } satisfies OidcTx, secret);
    return redirect(`${authority}/authorize?${p}`, [cookie(OIDC_COOKIE, tx, { maxAge: 600, path: '/auth/' })]);
  }

  if (route === 'callback') {
    const clear = cookie(OIDC_COOKIE, '', { maxAge: 0, path: '/auth/' });
    const tx = await verifyToken<OidcTx>(getCookie(req, OIDC_COOKIE), secret);
    if (!tx) return toLogin({ error: 'expired' }, [clear]);
    const err = url.searchParams.get('error');
    if (err) {
      if (tx.silent && SILENT_FAIL.has(err)) return toLogin({ returnTo: tx.returnTo }, [clear]);   // no SSO session: show login page
      console.warn('Entra error', err, url.searchParams.get('error_description'));
      return toLogin({ error: 'microsoft', returnTo: tx.returnTo }, [clear]);
    }
    if (url.searchParams.get('state') !== tx.state) { console.warn('Sign-in refused: state mismatch'); return toLogin({ error: 'state' }, [clear]); }

    const res = await fetch(`${authority}/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code',
        code: url.searchParams.get('code') || '', redirect_uri: redirectUri, code_verifier: tx.verifier, scope: 'openid profile email' }),
    });
    const tok = await res.json().catch(() => ({})) as { id_token?: string; error?: string; error_description?: string };
    if (!res.ok || !tok.id_token) { console.warn('Token exchange failed', tok.error, tok.error_description); return toLogin({ error: 'token' }, [clear]); }

    // The ID token came straight from Microsoft's token endpoint over TLS using our client secret,
    // so per OpenID Connect Core §3.1.3.7 the TLS server validation stands in for signature checks.
    const c = decodeJwtPayload(tok.id_token);
    const now = Date.now() / 1000;
    if (c.aud !== clientId || c.nonce !== tx.nonce || !(c.exp > now) || c.iss !== `https://login.microsoftonline.com/${c.tid}/v2.0`
        || (/^[0-9a-f-]{36}$/i.test(tenant) && c.tid !== tenant.toLowerCase())) {
      console.warn('Sign-in refused: ID token failed checks', { aud: c.aud === clientId, nonce: c.nonce === tx.nonce, tid: c.tid });
      return toLogin({ error: 'token' }, [clear]);
    }

    const user: User = { oid: c.oid, email: String(c.preferred_username || c.email || c.upn || '').toLowerCase(), name: c.name || c.preferred_username,
                         groups: Array.isArray(c.groups) ? c.groups.slice(0, 150) : [] };
    // Optional extra check on top of the tenant check: only these email domains (and their subdomains)
    const allowed = String(process.env.ALLOWED_EMAIL_DOMAINS || 'lwlat.org.uk').toLowerCase().split(/[\s,;]+/).filter(Boolean);
    const domain = user.email.split('@')[1] || '';
    if (!allowed.some(d => domain === d || domain.endsWith('.' + d))) {
      console.warn(`Sign-in refused: ${user.email} is not on an allowed email domain`);
      return toLogin({ error: 'noaccess', who: user.email }, [clear]);
    }
    const st = store();
    const access = await enrolPerson(st, user);
    await recordSignIn(st, user, access);
    if (!access.sites.length && !access.admin) {
      console.warn(`Sign-in refused: ${user.email} has no access (${access.role})`);
      return toLogin({ error: 'noaccess', who: user.email }, [clear]);
    }

    const session = await signToken({ ...user, exp: Math.floor(now) + SESSION_HOURS * 3600 }, secret);
    return redirect(tx.returnTo, [clear, cookie(SESSION_COOKIE, session, { maxAge: SESSION_HOURS * 3600 })]);
  }

  if (route === 'logout') {
    const after = `${base}/signed-out`;   // registered as a redirect URI in Entra too
    return redirect(`${authority}/logout?post_logout_redirect_uri=${encodeURIComponent(after)}`, [cookie(SESSION_COOKIE, '', { maxAge: 0 }), cookie(VIEWAS_COOKIE, '', { maxAge: 0 })]);
  }

  return new Response('Not found', { status: 404 });
};
