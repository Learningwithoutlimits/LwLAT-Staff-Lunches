// In-memory stand-in for the API, used by `npm run demo` (never part of a production build). Names are made up.
import type { Day, StaffMember, StateResponse } from '../../shared/types.ts';
import { DAY_KEYS, DEFAULT_SITES } from '../../shared/constants.ts';
import { demoDelay as d } from '../lib/dom.ts';
import type { HomeApi } from './api.ts';

const me = { name: 'Alex Taylor', email: 'alex.taylor@lwlat.org.uk' };
const at = new Date().toISOString();
const person = (site: string, name: string, jobTitle: string, days: Day[]): StaffMember =>
  ({ id: crypto.randomUUID(), site, name, jobTitle, email: '', days, createdAt: at, createdBy: me, updatedAt: at, updatedBy: me });
const all = [...DAY_KEYS];
const staff: StaffMember[] = [
  person('BAB', 'Jordan Ellis', 'Lunchtime supervisor', all), person('BAB', 'Priya Shah', 'Teaching assistant', ['mon', 'wed']),
  person('BAB', 'Chris Mason', 'Teacher', []), person('BAB', 'Sam Okafor', 'Cover supervisor', ['tue', 'thu', 'fri']),
  person('SWH', 'Ellie Ward', 'Learning support', all), person('SWH', 'Ravi Patel', 'Teacher', ['fri']),
  person('LAN', 'Morgan Reid', 'Learning mentor', ['tue', 'thu']), person('LAN', 'Dana Hughes', 'Site team', all),
  person('WOO', 'Lou Bennett', 'Midday supervisor', all), person('WOO', 'Kim Lowe', 'Teaching assistant', ['mon', 'tue', 'wed']),
  person('HEA', 'Ash Carter', 'Midday supervisor', all), person('LWL', 'Robin Fox', 'Trust office', []),
];
const key = (s: { name: string; email?: string }) => (s.email || '').toLowerCase() || 'name:' + s.name.toLowerCase();
const current = (site: string) => staff.filter(s => s.site === site && !s.removedAt);

export const mockApi: HomeApi = {
  state: () => d({ user: me, role: 'admin', admin: true, sites: DEFAULT_SITES.map(({ code, name }) => ({ code, name })),
    manage: DEFAULT_SITES.map(s => s.code), staff: staff.filter(s => !s.removedAt), viewingAs: null, feedback: true } satisfies StateResponse),
  setDays: (_site, id, days) => {
    const s = staff.find(x => x.id === id)!;
    Object.assign(s, { days: DAY_KEYS.filter(k => days.includes(k)), updatedAt: new Date().toISOString(), updatedBy: me });
    return d({ staff: s });
  },
  add: r => {
    if (current(r.site).some(s => key(s) === key(r))) return Promise.reject(new Error(`${r.name} is already on the list`));
    const s = { ...person(r.site, r.name.trim(), r.jobTitle ?? '', r.days ?? []), email: (r.email ?? '').toLowerCase() };
    staff.push(s); return d({ staff: s });
  },
  remove: (_site, id, reason) => {
    if (!reason.trim()) return Promise.reject(new Error('Give a reason for removing them'));
    const s = staff.find(x => x.id === id)!; s.removedAt = new Date().toISOString(); s.removedReason = reason;
    return d({ staff: s });
  },
  importList: r => {
    const now = current(r.site), incoming = new Map(r.rows.map(x => [key(x), x]));
    let added = 0, updated = 0, removed = 0, unchanged = 0;
    for (const [k, x] of incoming) {
      const s = now.find(y => key(y) === k);
      if (!s) { staff.push({ ...person(r.site, x.name, x.jobTitle ?? '', []), email: x.email ?? '' }); added++; }
      else if (s.jobTitle !== (x.jobTitle ?? '')) { s.jobTitle = x.jobTitle ?? ''; updated++; } else unchanged++;
    }
    if (r.removeMissing) for (const s of now) if (!incoming.has(key(s))) { s.removedAt = new Date().toISOString(); removed++; }
    return d({ site: r.site, staff: current(r.site), added, updated, removed, unchanged });
  },
  exportUrl: () => '#',
  stopViewAs: () => d({ viewingAs: null }),
};
