// Demo data for testing (SEED_DEMO=true only). Remove SEED_DEMO before go-live. Names are made up.
import type { Day, StaffMember } from '../../shared/types.ts';
import type { BlobStore } from './store.mts';

export async function seedIfEmpty(st: BlobStore) {
  if (process.env.SEED_DEMO !== 'true' || await st.get('meta/seeded', { type: 'json' })) return;
  const by = { name: 'Demo data', email: 'demo@lwlat.org.uk' }, at = new Date().toISOString();
  const person = (site: string, name: string, jobTitle: string, days: Day[]): StaffMember =>
    ({ id: crypto.randomUUID(), site, name, jobTitle, email: '', days, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by });
  const all: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
  await st.setJSON('staff/BAB', [person('BAB', 'Jordan Ellis', 'Lunchtime supervisor', all), person('BAB', 'Priya Shah', 'Teaching assistant', ['mon', 'wed']),
    person('BAB', 'Chris Mason', 'Teacher', [])]);
  await st.setJSON('staff/LAN', [person('LAN', 'Morgan Reid', 'Learning mentor', ['tue', 'thu'])]);
  await st.setJSON('meta/seeded', { at });
}
