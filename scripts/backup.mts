// Look at and restore the daily backups from a PC. Needs the site ID (Site configuration → General) and a
// Netlify personal access token (User settings → Applications). Delete the token afterwards.
//
//   $env:NETLIFY_SITE_ID="<site id>"; $env:NETLIFY_AUTH_TOKEN="<token>"
//   node scripts/backup.mts list                              backups held
//   node scripts/backup.mts show 2026-11-03                   what's in one
//   node scripts/backup.mts restore 2026-11-03 staff/BAB    shows what would change
//   node scripts/backup.mts restore 2026-11-03 staff/BAB --yes
//   node scripts/backup.mts restore 2026-11-03 --all --yes    everything
//
// Restoring overwrites only the keys named. It never deletes anything created since the backup.
// Record every restore in the IT change log.
import { getStore } from '@netlify/blobs';
import { BACKUP_STORE, STORE_NAME } from '../shared/constants.ts';

const { NETLIFY_SITE_ID: siteID, NETLIFY_AUTH_TOKEN: token } = process.env;
if (!siteID || !token) { console.error('Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN first.'); process.exit(1); }
const open = (name: string) => getStore({ name, siteID, token, region: 'eu-central-1' } as Parameters<typeof getStore>[0]);
const live = open(STORE_NAME), bk = open(BACKUP_STORE);
const [cmd, day, key] = process.argv.slice(2);
const yes = process.argv.includes('--yes'), all = process.argv.includes('--all');

const keysIn = async (d: string) => (await bk.list({ prefix: `backups/${d}/` })).blobs.map(b => b.key.slice(`backups/${d}/`.length));

if (cmd === 'list') {
  const days = new Set((await bk.list({ prefix: 'backups/' })).blobs.map(b => b.key.split('/')[1]));
  console.log([...days].sort().join('\n') || 'No backups yet.');
} else if (cmd === 'show' && day) {
  for (const k of await keysIn(day)) console.log(k);
} else if (cmd === 'restore' && day && (key || all)) {
  const keys = all ? await keysIn(day) : [key];
  for (const k of keys) {
    const saved = await bk.get(`backups/${day}/${k}`, { type: 'json' });
    if (saved == null) { console.log(`${k}: not in the ${day} backup`); continue; }
    const now = await live.get(k, { type: 'json' });
    const same = JSON.stringify(now) === JSON.stringify(saved);
    console.log(`${k}: ${same ? 'unchanged' : now == null ? 'missing now, would be put back' : 'would be replaced with the backup'}`);
    if (yes && !same) await live.setJSON(k, saved);
  }
  if (!yes) console.log('\nNothing changed. Add --yes to restore.');
} else {
  console.log('Usage: node scripts/backup.mts list | show <day> | restore <day> (<key> | --all) [--yes]');
}
