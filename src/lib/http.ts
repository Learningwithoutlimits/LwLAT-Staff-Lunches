// fetch wrapper for /api/* (Netlify Functions behind Entra SSO).
import type { ApiError } from '../../shared/types.ts';

export type HttpError = Error & { status?: number };

export async function call<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch('/api/' + path, { ...opts, credentials: 'same-origin', headers: { 'content-type': 'application/json', ...opts.headers } });
  if (res.status === 401) { // session expired: back through Microsoft SSO
    location.href = '/auth/login?silent=1&returnTo=' + encodeURIComponent(location.pathname + location.search);
    throw new Error('Signing you in…');
  }
  const body = await res.json().catch((): ApiError => ({ error: 'Unexpected response' }));
  if (!res.ok) throw Object.assign(new Error((body as ApiError).error || res.statusText), { status: res.status });
  return body as T;
}

export const send = <T, B = unknown>(method: 'POST' | 'PUT', path: string, body: B) =>
  call<T>(path, { method, body: JSON.stringify(body) });
