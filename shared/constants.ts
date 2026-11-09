// Values used by both the Netlify functions and the browser pages.

import type { Day } from './types.ts';

export const APP_NAME = 'Staff Free Lunches';      // shown in the change log, emails and feedback issues
// TODO(owner): confirm the team that runs the app and its support mailbox before go-live
export const TEAM_NAME = 'LwLAT IT Services';        // the team that runs the app (header eyebrow, emails)
export const SUPPORT_EMAIL = 'your-team@lwlat.org.uk'; // where people ask for help or access
/** The app's owners: always admins, and can never be locked out from the portal. Add more with ADMIN_EMAILS. */
// TODO(owner): add a second owner so the app can never be locked out
export const OWNER_EMAILS: string[] = ['twestwood@lwlat.org.uk'];
export const APP_TITLE = ['Staff Free', 'Lunches'];   // header title: first part white, second part lime
export const STORE_NAME = 'lwlat-staff-free-lunches'; // Netlify Blobs store. Never change once there's live data

/** The school week. Free lunches are only ever Monday to Friday. */
export const DAYS: { key: Day; short: string; long: string }[] = [
  { key: 'mon', short: 'Mon', long: 'Monday' },
  { key: 'tue', short: 'Tue', long: 'Tuesday' },
  { key: 'wed', short: 'Wed', long: 'Wednesday' },
  { key: 'thu', short: 'Thu', long: 'Thursday' },
  { key: 'fri', short: 'Fri', long: 'Friday' },
];
export const DAY_KEYS = DAYS.map(d => d.key);
/** Today's weekday in the UK as a Day, or null at the weekend. */
export const ukWeekday = (d = new Date()): Day | null => {
  const w = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(d).toLowerCase().slice(0, 3);
  return (DAY_KEYS as string[]).includes(w) ? w as Day : null;
};
export const BACKUP_STORE = `${STORE_NAME}-backups`;

export const RETENTION_DAYS = 1826;   // 5 years: agree this with the DPO and put it in the record of processing
export const BACKUP_DAYS = 30;
export const TZ = 'Europe/London';

/** The trust's sites. Codes are the standard ones used by every LwLAT app. */
export const DEFAULT_SITES = [
  { code: 'BAB', name: 'Babington Academy',            domains: ['babington.lwlat.org.uk'] },
  { code: 'SWH', name: 'South Wigston High School',    domains: ['southwigston.lwlat.org.uk'] },
  { code: 'LAN', name: 'Lancaster Academy',            domains: ['lancaster.lwlat.org.uk'] },
  { code: 'WOO', name: 'Woodstock Primary Academy',    domains: ['woodstock.lwlat.org.uk'] },
  { code: 'HEA', name: 'Heatherbrook Primary Academy', domains: ['heatherbrook.lwlat.org.uk'] },
  { code: 'LWL', name: 'LwLAT Central',                domains: ['lwlat.org.uk'] },
];

/** UK date and time, e.g. 06/11/2026 14:05 */
export const ukDateTime = (iso: string) => iso ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit',
  year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '';
/** UK calendar day as YYYY-MM-DD (for keys and file names) */
export const ukDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
