// The app's only way to read or write data. Every request re-checks the session and the person's access.
//   GET  /api/state                 staff and free-lunch days for the sites this person can see
//   POST /api/staff/days            set the weekdays one person gets a free lunch      } admins and site admins,
//   POST /api/staff/add             add one person by hand                             } for the sites they
//   POST /api/staff/remove          take someone off the list (kept with a reason)     } manage only
//   POST /api/staff/import          import a full staff list for one site              }
//   GET  /api/export?site=BAB       CSV of staff and their free-lunch days (formula-safe)
//   POST /api/feedback              Feedback button -> GitHub issue
//   GET|POST /api/viewas, POST /api/viewas/stop     admins viewing the app as someone else (read-only)
//   /api/admin/*                    admin portal: config, people, access, audit
import type { AddStaffRequest, AdminConfigResponse, AuditResponse, FeedbackRequest, FeedbackResponse, HealthState, ImportStaffRequest, ImportStaffResponse,
              PublicSite, RemoveStaffRequest, SaveAccessResponse, SavePeopleRequest, SeenEntry, SetDaysRequest, StaffResponse,
              StateResponse, UserRule, ViewAsRequest, ViewAsResponse } from '../../shared/types.ts';
import { toCsv } from '../../shared/csv.ts';
import { DAYS, ukDateTime } from '../../shared/constants.ts';
import { getUser, type User } from '../lib/auth.mts';
import { signToken, verifyToken, getCookie, cookie, VIEWAS_COOKIE, VIEWAS_MINUTES, type ViewAs } from '../lib/session.mts';
import { loadConfig, resolveAccess, sanitiseConfig, envAdmins, manageableRule, mergeSiteAdminPeople } from '../lib/config.mts';
import { store, getStaff, setDays, addStaff, removeStaff, importStaff, audit, getAudit, update, type HttpError } from '../lib/store.mts';
import { seedIfEmpty } from '../lib/seed.mts';
import { createIssue, feedbackOn } from '../lib/github.mts';

// Generous per-IP limit: a school's staff often share one public IP
export const config = { path: '/api/*', rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ['ip', 'domain'] } };

// netlify.toml [[headers]] only cover static files, so function responses set their own
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});

// Request bodies come from the browser, so every field is treated as possibly missing
const body = async <T,>(req: Request) => {
  try { return (await req.json() ?? {}) as Partial<T>; }
  catch { throw Object.assign(new Error('Invalid request'), { status: 400 }); }
};

const fail = (e: unknown) => {
  const { status, message } = e as Partial<HttpError>;
  if (!status) console.error(e);
  return json({ error: status ? message : 'Server error' }, status || 500);
};

// Refused requests go to the function log (Netlify → Logs → Functions → api) so probing stands out
export default async (req: Request, context?: { ip?: string }) => {
  const res = await handle(req).catch(fail);
  if (res.status === 401 || res.status === 403) {
    const who = (await getUser(req))?.email ?? 'not signed in';
    console.warn(`Refused ${res.status}: ${req.method} ${new URL(req.url).pathname} by ${who} from ${context?.ip ?? 'unknown IP'}`);
  }
  return res;
};

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, '');

  // CSRF: state-changing requests must come from our own pages, as JSON
  if (req.method !== 'GET') {
    const origin = req.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: 'Bad origin' }, 403);
    if (!(req.headers.get('content-type') || '').includes('application/json')) return json({ error: 'JSON only' }, 415);
  }

  const realUser = await getUser(req);
  if (!realUser) return json({ error: 'Not signed in' }, 401);

  const st = store();
  await seedIfEmpty(st);
  const cfg = await loadConfig(st);

  /* ---------------- view as (admins only, read-only) ---------------- */
  // The cookie is signed, tied to the admin who started it, and ignored as soon as they stop being an admin.
  const realAdmin = resolveAccess(realUser, cfg).admin;
  const va = realAdmin ? await verifyToken<ViewAs>(getCookie(req, VIEWAS_COOKIE), process.env.SESSION_SECRET) : null;
  const viewing = va && va.by === realUser.email ? va : null;
  const withCookie = (res: Response, c: string) => { res.headers.append('set-cookie', c); return res; };

  if (route === 'viewas' && req.method === 'GET')
    return json({ viewingAs: viewing ? { email: viewing.email, name: viewing.name } : null } satisfies ViewAsResponse);
  if (route === 'viewas/stop' && req.method === 'POST')
    return withCookie(json({ viewingAs: null } satisfies ViewAsResponse), cookie(VIEWAS_COOKIE, '', { maxAge: 0 }));
  if (route === 'viewas' && req.method === 'POST') {
    if (!realAdmin) return json({ error: 'Admins only' }, 403);
    const email = String((await body<ViewAsRequest>(req)).email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a full email address' }, 400);
    if (email === realUser.email) return json({ error: "That's you, so there's no need to view as yourself" }, 400);
    const seen: Record<string, SeenEntry> = (await st.get('meta/seen', { type: 'json' })) || {};
    const v: ViewAs = { email, name: seen[email]?.name || email, groups: seen[email]?.groups || [], by: realUser.email,
                        exp: Math.floor(Date.now() / 1000) + VIEWAS_MINUTES * 60 };
    await audit(st, realUser, 'access', `Viewed the app as ${email}`);
    return withCookie(json({ viewingAs: { email, name: v.name } } satisfies ViewAsResponse),
      cookie(VIEWAS_COOKIE, await signToken(v, process.env.SESSION_SECRET), { maxAge: VIEWAS_MINUTES * 60 }));
  }
  if (viewing && req.method !== 'GET') return json({ error: `You're viewing as ${viewing.name}, which is read-only. Stop viewing as them to make changes.` }, 403);

  const user: User = viewing ? { email: viewing.email, name: viewing.name, groups: viewing.groups } : realUser;
  const access = resolveAccess(user, cfg);
  if (!access.sites.length && !access.admin) return json({ error: viewing
    ? `${viewing.name} would be turned away: their account has no access (${access.role === 'blocked' ? 'blocked' : 'no matching rule'}).`
    : "Your account doesn't have access to this app. Ask the app's administrators to add you." }, 403);
  const allowed = (site?: string): site is string => !!site && access.sites.includes(site);
  const me = { name: user.name, email: user.email };
  const sitesOut = (codes: string[]): PublicSite[] => cfg.sites.filter(s => codes.includes(s.code)).map(({ code, name }) => ({ code, name }));

  /* ---------------- app ---------------- */
  if (req.method === 'GET' && route === 'state') {
    const staff = [];
    for (const s of access.sites) staff.push(...await getStaff(st, s));
    return json({ user: me, role: access.role, admin: access.manage.length > 0, sites: sitesOut(access.sites), manage: access.manage, staff,
      viewingAs: viewing ? { email: viewing.email, name: viewing.name } : null, feedback: feedbackOn() } satisfies StateResponse);
  }

  // Changing a staff list or someone's free lunches: admins, and site admins for their own sites. Checked here, every time.
  if (req.method === 'POST' && route.startsWith('staff/')) {
    const input = await body<SetDaysRequest & AddStaffRequest & RemoveStaffRequest & ImportStaffRequest>(req);
    const site = String(input.site || '');
    if (!access.manage.includes(site)) return json({ error: "Only admins for this site can change its staff list or free lunches" }, 403);
    const id = String(input.id || '');

    if (route === 'staff/days') {
      const { staff, detail } = await setDays(st, site, id, input.days, user, input.expectUpdatedAt);
      await audit(st, user, 'staff', `${site}: Free lunches for ${detail}`);
      return json({ staff } satisfies StaffResponse);
    }
    if (route === 'staff/add') {
      const staff = await addStaff(st, site, input, input.days, user);
      await audit(st, user, 'staff', `${site}: Added ${staff.name} to the staff list`);
      return json({ staff } satisfies StaffResponse);
    }
    if (route === 'staff/remove') {
      const gone = await removeStaff(st, site, id, input.reason, user);
      await audit(st, user, 'staff', `${site}: Removed ${gone.name} (${gone.removedReason})`);
      return json({ staff: gone } satisfies StaffResponse);
    }
    if (route === 'staff/import') {
      const counts = await importStaff(st, site, input.rows, input.removeMissing === true, input.reason, user);
      await audit(st, user, 'staff', `${site}: Imported a staff list (${counts.added} added, ${counts.updated} updated, ${counts.removed} removed)`);
      return json({ site, staff: await getStaff(st, site), ...counts } satisfies ImportStaffResponse);
    }
  }

  if (req.method === 'GET' && route === 'export') {
    const site = url.searchParams.get('site') || 'ALL';
    const sites = site === 'ALL' ? access.sites : [site];
    if (!sites.every(allowed)) return json({ error: 'Not permitted' }, 403);
    const rows: unknown[][] = [];
    for (const s of sites) for (const m of await getStaff(st, s))
      rows.push([m.site, m.name, m.jobTitle, m.email, ...DAYS.map(d => m.days.includes(d.key) ? 'Yes' : ''), m.days.length, ukDateTime(m.updatedAt), m.updatedBy.name]);
    return new Response(toCsv(['Site', 'Name', 'Job title', 'Email', ...DAYS.map(d => d.long), 'Free lunches a week', 'Last changed', 'Changed by'], rows), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="staff-free-lunches-${site}.csv"`,
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  }

  if (req.method === 'POST' && route === 'feedback') {
    if (!feedbackOn()) return json({ error: "Feedback isn't switched on yet" }, 501);
    const f = await body<FeedbackRequest>(req);
    const kind = f.kind === 'idea' || f.kind === 'question' ? f.kind : 'bug';
    const message = String(f.message || '').trim().slice(0, 4000);
    if (message.length < 5) return json({ error: 'Tell us a bit more' }, 400);
    // 5 per person per 10 minutes
    await update(st, `meta/feedback-${user.email}`, [] as string[], times => {
      const recent = times.filter(t => Date.now() - Date.parse(t) < 10 * 60_000);
      if (recent.length >= 5) throw Object.assign(new Error("You've sent a lot of feedback just now. Please try again in a few minutes."), { status: 429 });
      times.splice(0, times.length, ...recent, new Date().toISOString());
    });
    const impact = f.impact === 'blocked' ? "Can't carry on" : f.impact === 'slowed' ? 'Slowed down' : f.impact === 'minor' ? 'Minor' : undefined;
    const number = await createIssue({ kind, message, impact, details: f.details ? String(f.details) : undefined, role: access.role });
    await audit(st, user, 'feedback', `Sent feedback #${number} (${kind})`);
    return json({ number } satisfies FeedbackResponse);
  }

  /* ---------------- admin ---------------- */
  // Admins run every school. Site admins get the portal for their own schools only. Every route below checks which.
  if (route.startsWith('admin/')) {
    const full = access.admin, manage = access.manage;
    if (!manage.length) return json({ error: 'Admins only' }, 403);
    const manages = (site?: string) => !!site && manage.includes(site);
    const a = route.slice(6);

    if (req.method === 'GET' && a === 'config') {
      const allSeen: Record<string, SeenEntry> = (await st.get('meta/seen', { type: 'json' })) || {};
      const seenAccess = Object.fromEntries(Object.keys(allSeen).map(e => [e, resolveAccess({ email: e, groups: allSeen[e].groups || [] }, cfg)]));
      // a site admin sees only their schools, the Site people they can manage, and sign-ins that touch their schools
      const config = full ? cfg : { sites: cfg.sites.filter(s => manages(s.code)), centralDomains: [], groupRules: [],
        users: Object.fromEntries(Object.entries(cfg.users).filter(([, u]) => manageableRule(u, manage))) };
      const siteDomains = cfg.sites.filter(s => manages(s.code)).flatMap(s => s.domains);
      const theirs = (e: string) => { const x = seenAccess[e];
        if (x.role === 'site' || x.role === 'siteadmin') return x.sites.some(manages);
        if (x.role === 'none' || x.role === 'blocked') return siteDomains.includes(e.split('@')[1]);
        return false; };
      const seen = full ? allSeen : Object.fromEntries(Object.entries(allSeen).filter(([e]) => theirs(e)));
      const health = full ? (await st.get('meta/health', { type: 'json' }) as HealthState | null) : null;
      return json({ me, full, config, envAdmins: full ? envAdmins() : [], seen,
        seenAccess: Object.fromEntries(Object.keys(seen).map(e => [e, seenAccess[e]])), health } satisfies AdminConfigResponse);
    }

    const describe = (u: UserRule) => u.role + (u.sites.length ? ` (${u.sites.join(', ')})` : '');
    const peopleChanges = (before: Record<string, UserRule>, after: Record<string, UserRule>) => {
      const changes: string[] = [];
      for (const e of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const b = before[e], n = after[e];
        if (!b && n) changes.push(`Added ${e} as ${describe(n)}`);
        else if (b && !n) changes.push(`Removed ${e}`);
        else if (b && n && (describe(b) !== describe(n) || b.note !== n.note)) changes.push(`Changed ${e} to ${describe(n)}`);
      }
      return changes;
    };

    // a site admin saves just the Site people for their schools; see mergeSiteAdminPeople for the limits
    if (req.method === 'PUT' && a === 'people') {
      if (full) return json({ error: 'Admins save access from the full portal' }, 400);
      const { users } = await body<SavePeopleRequest>(req);
      const next = sanitiseConfig(mergeSiteAdminPeople(cfg, users ?? {}, manage, user.email));
      await st.setJSON('config/access', next);
      const changes = peopleChanges(cfg.users, next.users);
      if (changes.length) await audit(st, user, 'access', `${manage.join('/')}: ${changes.join('; ')}`);
      const mine = Object.fromEntries(Object.entries(next.users).filter(([, u]) => manageableRule(u, manage)));
      return json({ config: { sites: next.sites.filter(s => manages(s.code)), centralDomains: [], groupRules: [], users: mine } } satisfies SaveAccessResponse);
    }

    if (req.method === 'PUT' && a === 'access') {
      if (!full) return json({ error: 'Only a full admin can do that' }, 403);
      const next = sanitiseConfig(await body(req));
      // don't drop a site that still has staff on its list
      for (const s of cfg.sites) if (!next.sites.some(n => n.code === s.code) && (await getStaff(st, s.code)).length)
        return json({ error: `${s.name} still has staff on its list, so it can't be removed` }, 409);
      await st.setJSON('config/access', next);
      const changes = peopleChanges(cfg.users, next.users);
      if (JSON.stringify(cfg.sites) !== JSON.stringify(next.sites)) changes.push('Updated sites / domains');
      if (JSON.stringify(cfg.centralDomains) !== JSON.stringify(next.centralDomains)) changes.push(`Central domains: ${next.centralDomains.join(', ') || 'none'}`);
      if (JSON.stringify(cfg.groupRules) !== JSON.stringify(next.groupRules)) changes.push('Updated Entra group rules');
      if (changes.length) await audit(st, user, 'access', changes.join('; '));
      return json({ config: next } satisfies SaveAccessResponse);
    }

    if (req.method === 'GET' && a === 'audit') {
      // a site admin sees changes at their schools ("BAB: …") and their own changes
      const rows = (await getAudit(st)).filter(r => full || r.by?.email === user.email || manage.some(c => r.detail.startsWith(c + ':') || r.detail.startsWith(c + '/')));
      return json({ rows } satisfies AuditResponse);
    }
  }

  return json({ error: 'Not found' }, 404);
}
