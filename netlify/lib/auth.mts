// Who is making this request? Reads the signed session cookie set by /auth/callback.
import { verifyToken, getCookie, SESSION_COOKIE } from './session.mts';

export interface User { email: string; name: string; oid?: string; groups: string[] }

export async function getUser(req: Request): Promise<User | null> {
  // Local development only (`netlify dev`): AUTH_DEV_EMAIL skips Microsoft sign-in.
  if (process.env.CONTEXT === 'dev' && process.env.AUTH_DEV_EMAIL) {
    const email = process.env.AUTH_DEV_EMAIL.toLowerCase();
    return { email, name: process.env.AUTH_DEV_NAME || email, groups: [] };
  }
  const s = await verifyToken(getCookie(req, SESSION_COOKIE), process.env.SESSION_SECRET);
  return s ? { email: s.email, name: s.name, oid: s.oid, groups: s.groups || [] } : null;
}
