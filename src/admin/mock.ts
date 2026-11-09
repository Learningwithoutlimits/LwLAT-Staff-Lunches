// In-memory stand-in for the admin API, used by `npm run demo` (never part of a production build).
// /admin?siteadmin previews the portal as a site admin for Babington only.
import type { Access, AccessConfig, AccessRole, AuditRow, SeenEntry } from '../../shared/types.ts';
import { DEFAULT_SITES } from '../../shared/constants.ts';
import { demoDelay as d } from '../lib/dom.ts';
import type { AdminApi } from './api.ts';

const me = { name: 'Alex Taylor', email: 'alex.taylor@lwlat.org.uk' };
const config: AccessConfig = { sites: structuredClone(DEFAULT_SITES), centralDomains: [], groupRules: [],
  users: { 'site.manager@babington.lwlat.org.uk': { role: 'central', sites: [], note: 'Estates lead' },
           'recep@babington.lwlat.org.uk': { role: 'site', sites: ['BAB'], note: 'Reception' },
           'ex.contractor@lwlat.org.uk': { role: 'blocked', sites: [], note: 'Left' } } };
const ago = (h: number) => new Date(Date.now() - h * 36e5).toISOString();
const seen: Record<string, SeenEntry> = { [me.email]: { name: me.name, at: ago(0), access: 'admin' },
  'recep@babington.lwlat.org.uk': { name: 'Lisa Grant', at: ago(1), access: 'site' },
  'alex.morgan@outlook.com': { name: 'Alex Morgan', at: ago(2), access: 'none' } };
const audit: AuditRow[] = [{ at: ago(24), by: me, action: 'access', detail: 'Added recep@babington.lwlat.org.uk as site (BAB)' }];
const SITE_ADMIN = new URLSearchParams(location.search).has('siteadmin');
const acc = (role: AccessRole, sites: string[] = []): Access => ({ role, admin: role === 'admin', sites, manage: role === 'admin' ? DEFAULT_SITES.map(s => s.code) : [], source: null });

export const mockApi: AdminApi = {
  config: () => d({ me, full: !SITE_ADMIN, envAdmins: SITE_ADMIN ? [] : ['alex.taylor@lwlat.org.uk'],
    config: SITE_ADMIN ? { sites: config.sites.filter(s => s.code === 'BAB'), centralDomains: [], groupRules: [],
      users: Object.fromEntries(Object.entries(config.users).filter(([, u]) => u.role === 'site' && u.sites.every(c => c === 'BAB'))) } : config,
    seen, seenAccess: Object.fromEntries(Object.entries(seen).map(([e, s]) => [e, acc(s.access, s.access === 'site' ? ['BAB'] : [])])),
    health: SITE_ADMIN ? null : { checkedAt: ago(0), ok: true, failures: 0, problem: null, alertedAt: null, lastBackup: ago(10).slice(0, 10),
      expiries: [{ name: 'ENTRA_CLIENT_SECRET', expires: '2027-10-31', daysLeft: 359 }] } }),
  saveAccess: c => { Object.assign(config, structuredClone(c)); return d({ config }); },
  savePeople: users => { Object.assign(config.users, users); return d({ config }); },
  audit: () => d({ rows: audit }),
  viewAs: () => Promise.reject(new Error('View as works on the real site')),
  viewAsStatus: () => d({ viewingAs: null }),
  stopViewAs: () => d({ viewingAs: null }),
};
