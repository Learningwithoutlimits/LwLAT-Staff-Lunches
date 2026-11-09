// Access configuration: edited from the admin portal, stored in Netlify Blobs at config/access.
//
// How a signed-in user's access is worked out (first match wins):
//   1. OWNER_EMAILS + ADMIN_EMAILS -> admin (can never be locked out from the portal)
//   2. A person entry in the portal    -> admin / central / site admin / site(s) / blocked
//   3. Entra group rules               -> needs the "groups" claim on the app registration
//   4. Central domains                 -> all sites
//   5. Site domains                    -> that site (domains match exactly)
//   otherwise                          -> no access
// Access is re-checked on every request, so changes in the portal apply immediately.
import type { Access, AccessConfig, GroupRule, Role, UserRule } from '../../shared/types.ts';
import { DEFAULT_SITES, OWNER_EMAILS } from '../../shared/constants.ts';
import type { BlobStore } from './store.mts';

export const ROLES: Role[] = ['admin', 'central', 'siteadmin', 'site', 'blocked'];

// Starting point until changed in the admin portal. School staff sign in as @<school>.lwlat.org.uk and get
// their own site; trust staff (@lwlat.org.uk) get LwLAT Central only. babington.lwlat.org.uk never matches lwlat.org.uk.
export const DEFAULT_CONFIG: AccessConfig = {
  sites: structuredClone(DEFAULT_SITES),
  centralDomains: [],   // all-site access is an explicit admin choice
  groupRules: [],
  users: {},
};

export const envAdmins = () => [...new Set([...OWNER_EMAILS.map(e => e.toLowerCase()),
  ...String(process.env.ADMIN_EMAILS || '').toLowerCase().split(/[\s,;]+/).filter(Boolean)])];

export async function loadConfig(st: BlobStore): Promise<AccessConfig> {
  const saved = await st.get('config/access', { type: 'json' }) as Partial<AccessConfig> | null;
  const cfg: AccessConfig = { ...structuredClone(DEFAULT_CONFIG), ...structuredClone(saved ?? {}) };
  // Automatic rows stay visible in the portal but keep following the domain/group rules until an admin edits them
  const seen = Object.values(cfg.users).some(u => u.automatic) ? await st.get('meta/seen', { type: 'json' }) : null;
  for (const [email, u] of Object.entries(cfg.users)) if (u.automatic) {
    const access = resolveAccess({ email, groups: seen?.[email]?.groups ?? [] }, cfg);
    cfg.users[email] = { ...u, role: access.role === 'none' ? 'blocked' : access.role,
      sites: access.role === 'site' || access.role === 'siteadmin' ? access.sites : [] };
  }
  return cfg;
}

export function resolveAccess(user: { email?: string; groups?: string[] } | null, cfg: AccessConfig): Access {
  const all = cfg.sites.map(s => s.code);
  const email = String(user?.email || '').toLowerCase();
  const domain = email.split('@')[1] || '';
  const none: Access = { role: 'none', admin: false, sites: [], manage: [], source: null };
  const known = (codes: string[] = []) => [...new Set(codes)].filter(c => all.includes(c));
  if (!email) return none;

  if (envAdmins().includes(email)) return { role: 'admin', admin: true, sites: all, manage: all, source: 'env' };

  const u = cfg.users?.[email];
  if (u && !u.automatic) {
    if (u.role === 'blocked') return { ...none, role: 'blocked', source: 'person' };
    if (u.role === 'admin') return { role: 'admin', admin: true, sites: all, manage: all, source: 'person' };
    if (u.role === 'siteadmin') { const mine = known(u.sites); return { role: 'siteadmin', admin: false, sites: mine, manage: mine, source: 'person' }; }
    if (u.role === 'central') return { role: 'central', admin: false, sites: all, manage: [], source: 'person' };
    return { role: 'site', admin: false, sites: known(u.sites), manage: [], source: 'person' };
  }

  const rules = (cfg.groupRules || []).filter(r => (user?.groups || []).includes(r.groupId));
  if (rules.some(r => r.role === 'admin')) return { role: 'admin', admin: true, sites: all, manage: all, source: 'group' };
  if (rules.some(r => r.role === 'central')) return { role: 'central', admin: false, sites: all, manage: [], source: 'group' };
  const gSites = known(rules.flatMap(r => r.sites || []));
  const gManage = known(rules.filter(r => r.role === 'siteadmin').flatMap(r => r.sites || []));
  if (gManage.length) return { role: 'siteadmin', admin: false, sites: gSites, manage: gManage, source: 'group' };
  if (gSites.length) return { role: 'site', admin: false, sites: gSites, manage: [], source: 'group' };

  if ((cfg.centralDomains || []).includes(domain)) return { role: 'central', admin: false, sites: all, manage: [], source: 'domain' };
  const dSites = cfg.sites.filter(s => (s.domains || []).includes(domain)).map(s => s.code);
  if (dSites.length) return { role: 'site', admin: false, sites: dSites, manage: [], source: 'domain' };
  return none;
}

/** A rule a site admin may see and change: an ordinary Site person whose sites are all ones the site admin runs. */
export const manageableRule = (u: UserRule | undefined, manage: string[]) =>
  !!u && u.role === 'site' && u.sites.length > 0 && u.sites.every(c => manage.includes(c));

/**
 * Apply a site admin's edits to the people list. Only Site rules within their sites can be added, changed
 * or removed; their own rule and anyone with wider access are left exactly as they were. Throws 403 otherwise.
 */
export function mergeSiteAdminPeople(cfg: AccessConfig, submitted: Record<string, UserRule>, manage: string[], self: string) {
  const deny = (m: string): never => { throw Object.assign(new Error(m), { status: 403 }); };
  const users = { ...cfg.users };
  for (const [e, u] of Object.entries(cfg.users)) if (manageableRule(u, manage) && !(e in submitted)) delete users[e];
  for (const [raw, u] of Object.entries(submitted || {})) {
    const e = String(raw).trim().toLowerCase();
    if (e === self.toLowerCase()) deny("You can't change your own access");
    if (envAdmins().includes(e)) deny(`${e} is a built-in admin`);
    if (cfg.users[e] && !manageableRule(cfg.users[e], manage)) deny(`${e} has wider access than your schools, so only a full admin can change them`);
    if (u?.role !== 'site') deny('You can only give people the Site role');
    const sites = Array.isArray(u.sites) ? u.sites : [];
    if (!sites.length || !sites.every(c => manage.includes(c))) deny(`${e} can only be given your own sites (${manage.join(', ')})`);
    users[e] = { role: 'site', sites, note: u.note };
  }
  return { ...cfg, users };
}

const clean = (v: unknown, n = 120) => String(v ?? '').trim().slice(0, n);
const list = (v: unknown) => (Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/)).map(x => clean(x).toLowerCase()).filter(Boolean);

/** Validate and normalise a config coming from the admin portal. Throws 400 on bad input. */
export function sanitiseConfig(input: any): AccessConfig {
  const err = (m: string): never => { throw Object.assign(new Error(m), { status: 400 }); };
  const sites = ((input?.sites || []) as any[]).map(s => ({ code: clean(s.code, 6).toUpperCase(), name: clean(s.name, 80), domains: list(s.domains) }));
  if (!sites.length) err('At least one site is needed');
  for (const s of sites) {
    if (!/^[A-Z]{2,6}$/.test(s.code)) err(`Site code "${s.code}" must be 2–6 letters`);
    if (!s.name) err(`Site ${s.code} needs a name`);
  }
  if (new Set(sites.map(s => s.code)).size !== sites.length) err('Site codes must be unique');
  const codes = sites.map(s => s.code);
  const users: Record<string, UserRule> = {};
  for (const [email, u] of Object.entries<any>(input?.users || {})) {
    const e = clean(email).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) err(`"${email}" is not a valid email address`);
    const role: Role = ROLES.includes(u.role) ? u.role : 'site';
    const hasSites = role === 'site' || role === 'siteadmin';
    const s = hasSites ? ((u.sites || []) as string[]).filter(c => codes.includes(c)) : [];
    if (hasSites && !s.length) err(`${e} needs at least one site`);
    users[e] = { role, sites: s, note: clean(u.note, 80), ...(u.automatic === true ? { automatic: true } : {}) };
  }
  const groupRules: GroupRule[] = ((input?.groupRules || []) as any[]).map(r => ({
    groupId: clean(r.groupId, 60).toLowerCase(), label: clean(r.label, 80),
    role: ['admin', 'central', 'siteadmin', 'site'].includes(r.role) ? r.role : 'site',
    sites: ((r.sites || []) as string[]).filter(c => codes.includes(c)),
  })).filter(r => r.groupId);
  for (const r of groupRules) {
    if (!/^[0-9a-f-]{36}$/.test(r.groupId)) err(`Group ID "${r.groupId}" should be an Entra object ID (GUID)`);
    if ((r.role === 'site' || r.role === 'siteadmin') && !r.sites.length) err(`Group ${r.label || r.groupId} needs at least one site`);
  }
  for (const email of envAdmins()) if (users[email]) users[email] = { role: 'admin', sites: [], note: users[email].note };
  return { sites, centralDomains: list(input?.centralDomains), groupRules, users };
}
