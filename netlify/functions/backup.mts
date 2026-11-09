// Runs hourly. On the first run of each UK day it copies every key in the app's store into the separate
// backup store (BACKUP_STORE) as backups/<YYYY-MM-DD>/<key>, and deletes backups older than BACKUP_DAYS.
// Restore from a PC with scripts/backup.mts. Backups live on the same Netlify site, so they don't protect
// against the site itself being deleted: download an export from time to time as well.
import { BACKUP_DAYS, BACKUP_STORE, ukDay } from '../../shared/constants.ts';
import { store, namedStore, type BlobStore } from '../lib/store.mts';
import { brandedEmail, sendMail } from '../lib/mailer.mts';
import { APP_NAME } from '../../shared/constants.ts';

export const config = { schedule: '@hourly' };

// meta/feedback-* rate-limit counters aren't worth keeping
const SKIP = /^meta\/(feedback-|health$|backup$)/;

export async function runBackup(st: BlobStore, bk: BlobStore, now = new Date()) {
  const day = ukDay(now);
  const done = await st.get('meta/backup', { type: 'json' }) as { day?: string } | null;
  if (done?.day === day) return { day, copied: 0, skipped: true };
  let copied = 0;
  for (const { key } of (await st.list({ prefix: '' })).blobs) {
    if (SKIP.test(key)) continue;
    const data = await st.get(key, { type: 'json' });
    if (data != null) { await bk.setJSON(`backups/${day}/${key}`, data); copied++; }
  }
  const cutoff = ukDay(new Date(now.getTime() - BACKUP_DAYS * 864e5));
  for (const { key } of (await bk.list({ prefix: 'backups/' })).blobs) if (key.split('/')[1] < cutoff) await bk.delete(key);
  await st.setJSON('meta/backup', { day, at: now.toISOString(), copied });
  return { day, copied, skipped: false };
}

export default async () => {
  const st = store();
  try {
    const r = await runBackup(st, namedStore(BACKUP_STORE));
    if (!r.skipped) console.log(`Backup ${r.day}: ${r.copied} item(s)`);
  } catch (e) {
    console.error('Backup failed', e);
    // email at most once a day if there's been no backup for over 26 hours
    const last = await st.get('meta/backup', { type: 'json' }) as { at?: string; warned?: string } | null;
    const stale = !last?.at || Date.now() - Date.parse(last.at) > 26 * 3600_000;
    if (stale && last?.warned !== ukDay()) {
      await sendMail({ to: String(process.env.ALERT_EMAILS || '').split(/[\s,;]+/).filter(Boolean), subject: `${APP_NAME}: daily backup failed`,
        html: brandedEmail({ heading: 'Daily backup failed', paragraphs: [`${APP_NAME} hasn't been backed up for over 26 hours. Check Logs → Functions → backup in Netlify.`] }) });
      await st.setJSON('meta/backup', { ...last, warned: ukDay() });
    }
  }
};
