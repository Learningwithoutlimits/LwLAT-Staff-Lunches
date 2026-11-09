// Storage on Netlify Blobs (store STORE_NAME in shared/constants.ts, EU region).
//   config/access            -> access config (see config.mts)
//   staff/<SITE>             -> [StaffMember]                 one staff list per site, with each person's free-lunch days
//   audit/<YYYY-MM>          -> [{ at, by, action, detail }]   change log
//   meta/seen                -> { email: { name, at, access, groups } } recent sign-in attempts
//   meta/health              -> HealthState                     written by functions/health-check.mts
//   meta/feedback-<email>    -> [ISO times]                     feedback rate limit
// Shapes are in shared/types.ts. Every shared write goes through update(), so two people saving at the
// same moment can't overwrite each other: the second write retries on the fresh data.
import { getStore } from '@netlify/blobs';
import type { Access, AccessConfig, AuditRow, Day, Person, SeenEntry, StaffMember, StaffRow } from '../../shared/types.ts';
import { DAY_KEYS, RETENTION_DAYS, STORE_NAME } from '../../shared/constants.ts';
import { loadConfig, DEFAULT_CONFIG, resolveAccess } from './config.mts';

/** The part of a Netlify Blobs store this app uses (JSON values only). */
export interface BlobStore {
  get(key: string, opts?: { type: 'json' }): Promise<any>;
  getWithMetadata(key: string, opts: { type: 'json' }): Promise<{ data: any; etag?: string } | null>;
  set(key: string, data: string): Promise<unknown>;
  setJSON(key: string, data: unknown, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
  delete(key: string): Promise<void>;
}

declare global {
  // lets the automated tests and `npm run local` swap in an in-memory store
  var __APP_TEST_STORE__: BlobStore | undefined;
  var __APP_TEST_BACKUPS__: BlobStore | undefined;
}

// EU (Frankfurt). Never change once there's live data: Blobs doesn't move it.
const REGION = 'eu-central-1';
export const store = (): BlobStore => globalThis.__APP_TEST_STORE__
  ?? getStore({ name: STORE_NAME, consistency: 'strong', region: REGION } as Parameters<typeof getStore>[0]) as unknown as BlobStore;
export const namedStore = (name: string): BlobStore => globalThis.__APP_TEST_BACKUPS__
  ?? getStore({ name, consistency: 'strong', region: REGION } as Parameters<typeof getStore>[0]) as unknown as BlobStore;

export type HttpError = Error & { status: number };
export const httpError = (msg: string, status = 400): HttpError => Object.assign(new Error(msg), { status });
const monthKey = (iso: string) => iso.slice(0, 7);
const who = (u: Person): Person => ({ name: u.name, email: u.email });

/** Read-modify-write with optimistic concurrency (etag), retried on conflict. */
export async function update<T, R>(st: BlobStore, key: string, fallback: T, fn: (data: T) => R | Promise<R>, tries = 6): Promise<R> {
  for (let i = 0; i < tries; i++) {
    const cur = await st.getWithMetadata(key, { type: 'json' });
    const data: T = cur?.data ?? structuredClone(fallback);
    const result = await fn(data);
    const { modified } = await st.setJSON(key, data, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (modified) return result;
    await new Promise(r => setTimeout(r, 40 + Math.random() * 120));
  }
  throw httpError('Busy, please try again', 503);
}

/* ---------- staff and free lunches ---------- */
const staffKey = (site: string) => {
  if (!/^[A-Z]{2,6}$/.test(site)) throw httpError('Unknown site');   // storage keys are validated by the server
  return `staff/${site}`;
};
/** Everyone on a site's list, including removed staff (kept until retention deletes them). */
export const getAllStaff = async (st: BlobStore, site: string): Promise<StaffMember[]> => (await st.get(staffKey(site), { type: 'json' })) || [];
/** Current staff only, sorted by name. */
export const getStaff = async (st: BlobStore, site: string) =>
  (await getAllStaff(st, site)).filter(s => !s.removedAt).sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));

const MAX_STAFF = 3000;
const text = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const mail = (v: unknown) => { const e = text(v, 120).toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : ''; };
/** Weekdays only, in Monday-to-Friday order, no repeats. Anything else is dropped. */
export const cleanDays = (v: unknown): Day[] => DAY_KEYS.filter(d => Array.isArray(v) && v.includes(d));
/** How the same person is recognised across imports: work email if there is one, otherwise their name. */
const matchKey = (s: { name: string; email: string }) => s.email || 'name:' + s.name.toLowerCase();
const nextStamp = (prev: string, now: string) => now > prev ? now : new Date(Date.parse(prev) + 1).toISOString();
const daysText = (days: Day[]) => days.length ? days.map(d => d[0].toUpperCase() + d.slice(1)).join(', ') : 'none';

function cleanRow(r: Partial<StaffRow> | undefined) {
  const name = text(r?.name, 100);
  if (!name) throw httpError('Every member of staff needs a name');
  return { name, jobTitle: text(r?.jobTitle, 100), email: mail(r?.email) };
}

/** Change the weekdays one person gets a free lunch. The server stamps who and when. */
export async function setDays(st: BlobStore, site: string, id: string, days: unknown, user: Person, expectUpdatedAt?: string) {
  const next = cleanDays(days);
  return update(st, staffKey(site), [] as StaffMember[], arr => {
    const s = arr.find(x => x.id === id && !x.removedAt);
    if (!s) throw httpError('That member of staff is no longer on the list. Reload to see the latest.', 404);
    if (expectUpdatedAt && s.updatedAt !== expectUpdatedAt)
      throw httpError(`${s.updatedBy.name} changed ${s.name} at the same time. Reload to see their change.`, 409);
    const before = daysText(s.days);
    Object.assign(s, { days: next, updatedAt: nextStamp(s.updatedAt, new Date().toISOString()), updatedBy: who(user) });
    return { staff: structuredClone(s), detail: `${s.name}: ${before} → ${daysText(next)}` };
  });
}

/** Add one person by hand. */
export async function addStaff(st: BlobStore, site: string, row: Partial<StaffRow>, days: unknown, user: Person) {
  const r = cleanRow(row);
  return update(st, staffKey(site), [] as StaffMember[], arr => {
    const current = arr.filter(x => !x.removedAt);
    if (current.some(x => matchKey(x) === matchKey(r))) throw httpError(`${r.name} is already on the list`, 409);
    if (current.length >= MAX_STAFF) throw httpError(`A site can have at most ${MAX_STAFF} staff`);
    const now = new Date().toISOString(), by = who(user);
    const s: StaffMember = { id: crypto.randomUUID(), site, ...r, days: cleanDays(days), createdAt: now, createdBy: by, updatedAt: now, updatedBy: by };
    arr.push(s);
    return structuredClone(s);
  });
}

/** Take someone off the list. They're kept with the reason (not deleted) until the retention period passes. */
export async function removeStaff(st: BlobStore, site: string, id: string, reason: unknown, user: Person) {
  const why = text(reason, 200);
  if (!why) throw httpError('Give a reason for removing them');
  return update(st, staffKey(site), [] as StaffMember[], arr => {
    const s = arr.find(x => x.id === id && !x.removedAt);
    if (!s) throw httpError('That member of staff has already been removed', 404);
    const now = new Date().toISOString();
    Object.assign(s, { removedAt: now, removedBy: who(user), removedReason: why, updatedAt: nextStamp(s.updatedAt, now), updatedBy: who(user) });
    return structuredClone(s);
  });
}

/**
 * Import a full staff list for one site. New people are added with no free lunches; people already on the list
 * (same email, or same name if there's no email) keep their days and get their name and job title refreshed.
 * With removeMissing, current staff who aren't in the file are removed with the reason given.
 */
export async function importStaff(st: BlobStore, site: string, rows: unknown, removeMissing: boolean, reason: unknown, user: Person) {
  if (!Array.isArray(rows) || !rows.length) throw httpError('The staff list is empty');
  if (rows.length > MAX_STAFF) throw httpError(`A staff list can have at most ${MAX_STAFF} people`);
  const incoming = new Map<string, ReturnType<typeof cleanRow>>();
  for (const raw of rows) { const r = cleanRow(raw); incoming.set(matchKey(r), r); }   // a repeated person counts once
  const why = text(reason, 200) || 'Not on the imported staff list';
  return update(st, staffKey(site), [] as StaffMember[], arr => {
    const now = new Date().toISOString(), by = who(user);
    const counts = { added: 0, updated: 0, removed: 0, unchanged: 0 };
    const current = new Map(arr.filter(x => !x.removedAt).map(x => [matchKey(x), x]));
    for (const [k, r] of incoming) {
      const s = current.get(k);
      if (!s) {
        arr.push({ id: crypto.randomUUID(), site, ...r, days: [], createdAt: now, createdBy: by, updatedAt: now, updatedBy: by });
        counts.added++;
      } else if (s.name !== r.name || s.jobTitle !== r.jobTitle) {
        Object.assign(s, { name: r.name, jobTitle: r.jobTitle, updatedAt: nextStamp(s.updatedAt, now), updatedBy: by });
        counts.updated++;
      } else counts.unchanged++;
    }
    if (removeMissing) for (const [k, s] of current) if (!incoming.has(k)) {
      Object.assign(s, { removedAt: now, removedBy: by, removedReason: why, updatedAt: nextStamp(s.updatedAt, now), updatedBy: by });
      counts.removed++;
    }
    return counts;
  });
}

/* ---------- change log + sign-in register ---------- */
export async function audit(st: BlobStore, user: Person, action: AuditRow['action'], detail: string) {
  const at = new Date().toISOString();
  await update(st, `audit/${monthKey(at)}`, [] as AuditRow[], arr => { arr.push({ at, by: who(user), action, detail }); });
}

export async function getAudit(st: BlobStore, months = 6) {
  const { blobs } = await st.list({ prefix: 'audit/' });
  const rows: AuditRow[] = [];
  for (const k of blobs.map(b => b.key).sort().slice(-months)) rows.push(...((await st.get(k, { type: 'json' })) || []));
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/** Persist a successful first sign-in as an automatic rule, without replacing an administrator's edits. */
export async function enrolPerson(st: BlobStore, user: Person & { groups?: string[] }): Promise<Access> {
  const cfg = await loadConfig(st);
  const access = resolveAccess(user, cfg);
  if (cfg.users[user.email] || (!access.admin && !access.sites.length)) return access;
  return update(st, 'config/access', DEFAULT_CONFIG, (saved: AccessConfig) => {
    const current = { ...structuredClone(DEFAULT_CONFIG), ...saved };
    const latest = resolveAccess(user, current);
    if (!current.users[user.email] && (latest.admin || latest.sites.length) && latest.role !== 'none') {
      current.users[user.email] = { role: latest.role,
        sites: latest.role === 'site' || latest.role === 'siteadmin' ? latest.sites : [], note: 'Added automatically at first sign-in', automatic: true };
    }
    Object.assign(saved, current);
    return resolveAccess(user, current);
  });
}

/** Every sign-in attempt, including people turned away, for Admin → Sign-ins. Keeps the latest 500. */
export async function recordSignIn(st: BlobStore, user: Person & { groups?: string[] }, access: Access) {
  try {
    await update(st, 'meta/seen', {} as Record<string, SeenEntry>, seen => {
      seen[user.email] = { name: user.name, at: new Date().toISOString(), access: access.role, groups: user.groups || [] };
      const keys = Object.keys(seen);
      if (keys.length > 500) keys.sort((a, b) => seen[a].at.localeCompare(seen[b].at)).slice(0, keys.length - 500).forEach(k => delete seen[k]);
    });
  } catch { /* never block sign-in on this */ }
}

/* ---------- retention ---------- */
/** Delete change-log entries older than RETENTION_DAYS, and staff removed from a list more than RETENTION_DAYS ago. */
export async function prune(st: BlobStore) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 864e5).toISOString();
  const cutMonth = monthKey(cutoff);
  let removed = 0;
  for (const b of (await st.list({ prefix: 'audit/' })).blobs) {
    const m = b.key.split('/').pop()!;
    if (m < cutMonth) { removed += ((await st.get(b.key, { type: 'json' })) || []).length; await st.delete(b.key); }
    else if (m === cutMonth) await update(st, b.key, [] as AuditRow[], arr => {
      const keep = arr.filter(r => r.at >= cutoff); removed += arr.length - keep.length; arr.splice(0, arr.length, ...keep);
    });
  }
  for (const b of (await st.list({ prefix: 'staff/' })).blobs) await update(st, b.key, [] as StaffMember[], arr => {
    const keep = arr.filter(s => !s.removedAt || s.removedAt >= cutoff); removed += arr.length - keep.length; arr.splice(0, arr.length, ...keep);
  });
  return { cutoff, removed };
}
