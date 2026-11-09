// End-to-end tests: sign-in, the gate, access rules, staff lists and free lunches, admin portal, retention, backups, health.
// Run with `npm test`. No Microsoft, Netlify or GitHub account needed: all are simulated.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AdminConfigResponse, AuditResponse, ImportStaffResponse, StaffMember, StaffResponse, StateResponse } from '../shared/types.ts';
import { memoryStore } from './memory-store.mts';

const TENANT = '11111111-2222-3333-4444-555555555555';
const B = 'https://app.example';
Object.assign(process.env, { ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: 'cid', ENTRA_CLIENT_SECRET: 'sec',
  SESSION_SECRET: 'x'.repeat(40), ADMIN_EMAILS: 'owner@lwlat.org.uk' });
globalThis.__APP_TEST_STORE__ = memoryStore();
globalThis.__APP_TEST_BACKUPS__ = memoryStore();

const api = (await import('../netlify/functions/api.mts')).default;
const auth = (await import('../netlify/functions/auth.mts')).default;
const gate = (await import('../netlify/edge-functions/gate.ts')).default;
const { signToken, SESSION_COOKIE } = await import('../netlify/lib/session.mts');
const { resolveAccess, DEFAULT_CONFIG, sanitiseConfig } = await import('../netlify/lib/config.mts');
const { store, prune, addStaff, setDays } = await import('../netlify/lib/store.mts');
const { previewImport, parseCsv } = await import('../src/home/import.ts');
const { runBackup } = await import('../netlify/functions/backup.mts');
const { expiries } = await import('../netlify/functions/health-check.mts');
const { toCsv } = await import('../shared/csv.ts');

const sessionFor = async (email: string, name = email) =>
  `${SESSION_COOKIE}=` + encodeURIComponent(await signToken({ email, name, exp: Date.now() / 1000 + 3600 }, process.env.SESSION_SECRET));
const get = (path: string, cookie?: string) => api(new Request(B + path, { headers: cookie ? { cookie } : {} }));
const send = (method: string, path: string, cookie: string, body: unknown, origin = B) => api(new Request(B + path, {
  method, headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const json = async <T,>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const idToken = (claims: object) => 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';

let ADMIN: string, BAB: string, LAN: string, OUTSIDER: string;
before(async () => {
  ADMIN = await sessionFor('owner@lwlat.org.uk', 'App Owner');
  BAB = await sessionFor('reception@babington.lwlat.org.uk', 'Lisa Grant');
  LAN = await sessionFor('office@lancaster.lwlat.org.uk', 'Sam Lee');
  OUTSIDER = await sessionFor('someone@gmail.com', 'Someone');
});

/* ---------- access rules ---------- */
test('domain rules: school subdomain -> own site, lwlat.org.uk -> Central site only, others -> none', () => {
  const r = (e: string) => resolveAccess({ email: e }, DEFAULT_CONFIG);
  assert.deepEqual(r('a@babington.lwlat.org.uk').sites, ['BAB']);
  assert.deepEqual(r('tech@lwlat.org.uk').sites, ['LWL']);
  assert.equal(r('owner@lwlat.org.uk').role, 'admin');
  assert.equal(r('someone@gmail.com').role, 'none');
  assert.equal(r('x@evil-lwlat.org.uk').role, 'none');
});

test('manual overrides beat domain rules, and protected admins can never be demoted', () => {
  const cfg = sanitiseConfig({ ...DEFAULT_CONFIG, users: {
    'cover@lancaster.lwlat.org.uk': { role: 'site', sites: ['LAN', 'WOO'] }, 'left@lwlat.org.uk': { role: 'blocked' },
    'owner@lwlat.org.uk': { role: 'blocked' } } });
  assert.deepEqual(resolveAccess({ email: 'cover@lancaster.lwlat.org.uk' }, cfg).sites, ['LAN', 'WOO']);
  assert.equal(resolveAccess({ email: 'left@lwlat.org.uk' }, cfg).role, 'blocked');
  assert.equal(resolveAccess({ email: 'owner@lwlat.org.uk' }, cfg).role, 'admin');
});

/* ---------- gate + sessions ---------- */
test('the gate refuses pages and API without a session, and fails closed without SESSION_SECRET', async () => {
  const env = new Map<string, string>([['SESSION_SECRET', 'x'.repeat(40)]]);
  (globalThis as any).Netlify = { env: { get: (k: string) => env.get(k) } };
  const next = () => new Response('ok');
  assert.equal((await gate(new Request(B + '/api/state'), { next })).status, 401);
  assert.match((await gate(new Request(B + '/admin'), { next })).headers.get('location') ?? '', /\/auth\/login\?silent=1/);
  assert.equal(await (await gate(new Request(B + '/', { headers: { cookie: ADMIN } }), { next })).text(), 'ok');
  env.delete('SESSION_SECRET');
  assert.equal((await gate(new Request(B + '/api/state', { headers: { cookie: ADMIN } }), { next })).status, 401);
});

test('no session -> 401; tampered session -> 401; no access -> 403', async () => {
  assert.equal((await get('/api/state')).status, 401);
  assert.equal((await get('/api/state', BAB.slice(0, -4) + 'abcd')).status, 401);
  assert.equal((await get('/api/state', OUTSIDER)).status, 403);
});

test('sign-in refuses an ID token for another tenant, audience or nonce', async () => {
  const login = await auth(new Request(B + '/auth/login?returnTo=/admin'));
  const oidc = login.headers.get('set-cookie')!.split(';')[0];
  const q = new URL(login.headers.get('location')!).searchParams;
  const state = q.get('state')!, nonce = q.get('nonce')!;
  const realFetch = globalThis.fetch;
  const claims = (extra: object) => ({ aud: 'cid', tid: TENANT, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    nonce, exp: Date.now() / 1000 + 600, preferred_username: 'owner@lwlat.org.uk', name: 'App Owner', ...extra });
  const other = '99999999-2222-3333-4444-555555555555';
  try {
    for (const bad of [{ tid: other, iss: `https://login.microsoftonline.com/${other}/v2.0` }, { aud: 'other' }, { nonce: 'wrong' }]) {
      globalThis.fetch = async () => Response.json({ id_token: idToken(claims(bad)) });
      const r = await auth(new Request(`${B}/auth/callback?code=c&state=${state}`, { headers: { cookie: oidc } }));
      assert.match(r.headers.get('location') ?? '', /error=token/, JSON.stringify(bad));
    }
    // and the genuine token signs in, back to the page asked for
    globalThis.fetch = async () => Response.json({ id_token: idToken(claims({})) });
    const ok = await auth(new Request(`${B}/auth/callback?code=c&state=${state}`, { headers: { cookie: oidc } }));
    assert.equal(ok.headers.get('location'), '/admin');
    assert.match(ok.headers.getSetCookie().join('\n'), new RegExp(`${SESSION_COOKIE}=[^;]+; Path=/; HttpOnly; Secure; SameSite=Lax`));
  } finally { globalThis.fetch = realFetch; }
});

test('sign-out clears the session and signs out of Microsoft, back to /signed-out', async () => {
  const r = await auth(new Request(B + '/auth/logout'));
  assert.match(r.headers.get('location') ?? '', /oauth2\/v2\.0\/logout\?post_logout_redirect_uri=.*signed-out/);
  assert.match(r.headers.get('set-cookie') ?? '', new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`));
});

/* ---------- requests ---------- */
test('cross-site and non-JSON writes are refused, and bad JSON is a 400 not a 500', async () => {
  assert.equal((await send('POST', '/api/staff/add', ADMIN, { site: 'BAB', name: 'x' }, 'https://evil.example')).status, 403);
  const form = await api(new Request(B + '/api/staff/add', { method: 'POST', headers: { cookie: ADMIN, origin: B, 'content-type': 'text/plain' }, body: 'x' }));
  assert.equal(form.status, 415);
  const bad = await api(new Request(B + '/api/staff/add', { method: 'POST', headers: { cookie: ADMIN, origin: B, 'content-type': 'application/json' }, body: '{' }));
  assert.equal(bad.status, 400);
});

/* ---------- staff free lunches ---------- */
test('import: adds new staff with no lunches, keeps existing days, and removes missing staff only when asked (with a reason)', async () => {
  const site = 'SWH';
  const first = await json<ImportStaffResponse>(send('POST', '/api/staff/import', ADMIN, { site, rows: [
    { name: 'Ann Lee', jobTitle: 'Teacher', email: 'ANN@southwigston.lwlat.org.uk' }, { name: 'Bob Day' }, { name: 'Bob Day' }, { name: 'Cal Fry' }] }));
  assert.deepEqual([first.added, first.removed], [3, 0]);
  assert.ok(first.staff.every(s => s.days.length === 0));
  const ann = first.staff.find(s => s.email === 'ann@southwigston.lwlat.org.uk')!;
  await send('POST', '/api/staff/days', ADMIN, { site, id: ann.id, days: ['fri', 'mon', 'sat', 'mon'] });
  const again = await json<ImportStaffResponse>(send('POST', '/api/staff/import', ADMIN, { site, rows: [
    { name: 'Ann Lee-Smith', jobTitle: 'Head of maths', email: 'ann@southwigston.lwlat.org.uk' }, { name: 'Bob Day' }], removeMissing: true, reason: 'Left' }));
  assert.deepEqual([again.added, again.updated, again.removed, again.unchanged], [0, 1, 1, 1]);
  const annNow = again.staff.find(s => s.id === ann.id)!;
  assert.deepEqual(annNow.days, ['mon', 'fri']);   // weekdays only, in order, kept through the import
  assert.equal(annNow.name, 'Ann Lee-Smith');
  const stored = await store().get('staff/SWH', { type: 'json' }) as StaffMember[];
  assert.equal(stored.find(s => s.name === 'Cal Fry')?.removedReason, 'Left');
});

test('free lunches: only admins for a site can change it; a site admin cannot reach another site; the server stamps who', async () => {
  const cfg = await json<AdminConfigResponse>(get('/api/admin/config', ADMIN));
  cfg.config.users['kitchen@babington.lwlat.org.uk'] = { role: 'siteadmin', sites: ['BAB'], note: '' };
  assert.equal((await send('PUT', '/api/admin/access', ADMIN, cfg.config)).status, 200);
  const KITCHEN = await sessionFor('kitchen@babington.lwlat.org.uk', 'Kitchen Lead');
  const { staff } = await json<StaffResponse>(send('POST', '/api/staff/add', KITCHEN,
    { site: 'BAB', name: 'Dee Moss', days: ['tue'], createdBy: { name: 'Fake', email: 'x' } }));
  assert.equal(staff.createdBy.email, 'kitchen@babington.lwlat.org.uk');
  assert.equal((await send('POST', '/api/staff/add', KITCHEN, { site: 'BAB', name: 'dee moss' })).status, 409);
  // ordinary site staff can see their own site but not change it, and can't see other sites
  assert.equal((await send('POST', '/api/staff/days', BAB, { site: 'BAB', id: staff.id, days: ['mon'] })).status, 403);
  const babState = await json<StateResponse>(get('/api/state', BAB));
  assert.ok(babState.staff.some(s => s.id === staff.id));
  assert.deepEqual(babState.manage, []);
  const lanState = await json<StateResponse>(get('/api/state', LAN));
  assert.ok(!lanState.staff.some(s => s.site === 'BAB'));
  assert.equal((await get('/api/export?site=BAB', LAN)).status, 403);
  // a site admin for BAB can't change Lancaster, or give themselves wider access
  assert.equal((await send('POST', '/api/staff/import', KITCHEN, { site: 'LAN', rows: [{ name: 'x' }] })).status, 403);
  assert.equal((await send('POST', '/api/staff/days', KITCHEN, { site: 'LAN', id: staff.id, days: ['mon'] })).status, 403);
  assert.equal((await send('PUT', '/api/admin/people', KITCHEN, { users: { 'kitchen@babington.lwlat.org.uk': { role: 'site', sites: ['BAB', 'LAN'], note: '' } } })).status, 403);
  // removing needs a reason, and is logged
  assert.equal((await send('POST', '/api/staff/remove', KITCHEN, { site: 'BAB', id: staff.id, reason: ' ' })).status, 400);
  assert.equal((await send('POST', '/api/staff/remove', KITCHEN, { site: 'BAB', id: staff.id, reason: 'Left the school' })).status, 200);
  const audit = await json<AuditResponse>(get('/api/admin/audit', ADMIN));
  assert.ok(audit.rows.some(r => r.detail === 'BAB: Added Dee Moss to the staff list' && r.by.name === 'Kitchen Lead'));
  assert.ok(audit.rows.some(r => r.detail === 'BAB: Removed Dee Moss (Left the school)'));
});

test('unknown sites and storage keys are refused', async () => {
  assert.equal((await send('POST', '/api/staff/add', ADMIN, { site: '../config', name: 'x' })).status, 403);
  await assert.rejects(setDays(store(), 'bad/key', 'x', [], { name: 'a', email: 'a@x' }), /Unknown site/);
});

test('two people saving at once: neither change is lost, and a stale edit is refused', async () => {
  const st = store(), u1 = { name: 'A', email: 'a@x' }, u2 = { name: 'B', email: 'b@x' };
  await Promise.all(Array.from({ length: 10 }, (_, i) => addStaff(st, 'HEA', { name: `Person ${i}` }, [], i % 2 ? u1 : u2)));
  assert.equal(((await st.get('staff/HEA', { type: 'json' })) as unknown[]).length, 10);
  const s = await addStaff(st, 'HEA', { name: 'Shared' }, [], u1);
  await setDays(st, 'HEA', s.id, ['mon'], u1, s.updatedAt);
  await assert.rejects(setDays(st, 'HEA', s.id, ['tue'], u2, s.updatedAt), /changed Shared at the same time/);
});

test('the staff list importer reads CSV in the browser and only keeps the needed columns', () => {
  const csv = '﻿Title,Forename,Surname,Role,Email,NI number\r\nMrs,Jo,"Smith, Jr",Teacher,jo@x.org,AB123\r\nMr,,,,,\r\nMr,Al,Brown,"TA ""Lead""",not-an-email,CD456\r\n';
  const p = previewImport(csv, []);
  assert.deepEqual(p.rows, [{ name: 'Jo Smith, Jr', jobTitle: 'Teacher', email: 'jo@x.org' }, { name: 'Al Brown', jobTitle: 'TA "Lead"', email: '' }]);
  assert.equal(p.warnings.length, 2);   // the row with no name, and the bad email
  assert.throws(() => previewImport('Colour\nRed\n', []), /name column/);
  assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
});

test('CSV export escapes formulas and lists the days', async () => {
  await send('POST', '/api/staff/add', ADMIN, { site: 'BAB', name: '=HYPERLINK("http://evil")', days: ['wed'] });
  const csv = await (await get('/api/export?site=BAB', BAB)).text();
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"")"`));
  assert.ok(csv.replace(/^﻿/, '').startsWith('"Site","Name","Job title","Email","Monday","Tuesday","Wednesday","Thursday","Friday"'));
  assert.equal(toCsv(['a'], [['+1'], ['@x'], ['-2'], ['ok']]), '﻿"a"\r\n"\'+1"\r\n"\'@x"\r\n"\'-2"\r\n"ok"\r\n');
});

/* ---------- admin ---------- */
test('admin portal: admins only; a site admin sees only their school and can only give Site access to it', async () => {
  assert.equal((await get('/api/admin/config', BAB)).status, 403);
  const cfg = await json<AdminConfigResponse>(get('/api/admin/config', ADMIN));
  cfg.config.users['it@babington.lwlat.org.uk'] = { role: 'siteadmin', sites: ['BAB'], note: '' };
  assert.equal((await send('PUT', '/api/admin/access', ADMIN, cfg.config)).status, 200);
  const IT = await sessionFor('it@babington.lwlat.org.uk', 'IT Tech');
  const mine = await json<AdminConfigResponse>(get('/api/admin/config', IT));
  assert.equal(mine.full, false);
  assert.deepEqual(mine.config.sites.map(s => s.code), ['BAB']);
  assert.equal((await send('PUT', '/api/admin/access', IT, mine.config)).status, 403);
  assert.equal((await send('PUT', '/api/admin/people', IT, { users: { 'x@lancaster.lwlat.org.uk': { role: 'site', sites: ['LAN'], note: '' } } })).status, 403);
  assert.equal((await send('PUT', '/api/admin/people', IT, { users: { 'it@babington.lwlat.org.uk': { role: 'site', sites: ['BAB'], note: '' } } })).status, 403);
  assert.equal((await send('PUT', '/api/admin/people', IT, { users: { 'new@babington.lwlat.org.uk': { role: 'site', sites: ['BAB'], note: '' } } })).status, 200);
});

test('view as is read-only and admin-only', async () => {
  assert.equal((await send('POST', '/api/viewas', BAB, { email: 'office@lancaster.lwlat.org.uk' })).status, 403);
  const r = await send('POST', '/api/viewas', ADMIN, { email: 'office@lancaster.lwlat.org.uk' });
  const va = r.headers.get('set-cookie')!.split(';')[0];
  const state = await json<StateResponse>(get('/api/state', `${ADMIN}; ${va}`));
  assert.deepEqual(state.sites.map(s => s.code), ['LAN']);
  assert.equal((await send('POST', '/api/staff/add', `${ADMIN}; ${va}`, { site: 'LAN', name: 'x' })).status, 403);
});

test('feedback is off without a token', async () => {
  assert.equal((await send('POST', '/api/feedback', BAB, { kind: 'bug', message: 'Something broke' })).status, 501);
});

/* ---------- scheduled jobs ---------- */
test('retention deletes staff removed over 5 years ago, and never current staff', async () => {
  const st = store(), old = new Date(Date.now() - 6 * 365 * 864e5).toISOString(), by = { name: 'x', email: 'x' };
  const m = (id: string, removedAt?: string) => ({ id, site: 'WOO', name: id, jobTitle: '', email: '', days: [], createdAt: old, createdBy: by,
    updatedAt: old, updatedBy: by, ...(removedAt ? { removedAt, removedBy: by, removedReason: 'Left' } : {}) });
  await st.setJSON('staff/WOO', [m('gone', old), m('current'), m('recent', new Date().toISOString())]);
  await prune(st);
  assert.deepEqual((await st.get('staff/WOO', { type: 'json' }) as StaffMember[]).map(s => s.id), ['current', 'recent']);
});

test('daily backup copies the store once a day and skips rate-limit counters', async () => {
  const st = store(), bk = globalThis.__APP_TEST_BACKUPS__!;
  await st.setJSON('meta/feedback-x@y', ['t']);
  const first = await runBackup(st, bk, new Date('2026-11-06T09:00:00Z'));
  assert.ok(first.copied > 0);
  assert.ok(await bk.get('backups/2026-11-06/config/access', { type: 'json' }));
  assert.equal(await bk.get('backups/2026-11-06/meta/feedback-x@y', { type: 'json' }), null);
  assert.equal((await runBackup(st, bk, new Date('2026-11-06T10:00:00Z'))).skipped, true);
});

test('credential expiry dates are read from *_EXPIRES variables', () => {
  process.env.ENTRA_CLIENT_SECRET_EXPIRES = '2026-11-13';
  const e = expiries(new Date('2026-11-06T12:00:00Z')).find(x => x.name === 'ENTRA_CLIENT_SECRET');
  assert.equal(e?.daysLeft, 7);
  delete process.env.ENTRA_CLIENT_SECRET_EXPIRES;
});
