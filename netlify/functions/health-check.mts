// Every 5 minutes: is the app working, and is any credential about to expire?
//
// Health: reads storage and checks Microsoft sign-in can be reached. After 2 failed checks in a row, ALERT_EMAILS
// get a "having problems" email (repeated hourly while it lasts), then a "working again" email once it passes.
// Expiry: every environment variable ending _EXPIRES (YYYY-MM-DD), e.g. ENTRA_CLIENT_SECRET_EXPIRES. Reminders go to
// EXPIRY_EMAILS (or ALERT_EMAILS) 21, 7 and 1 days before, and once when expired, between 08:00 and 18:00 UK time.
// Both need email set up (lib/mailer.mts). State is kept in meta/health and shown on Admin → Security review.
import type { HealthState } from '../../shared/types.ts';
import { APP_NAME, TZ, ukDay } from '../../shared/constants.ts';
import { store, type BlobStore } from '../lib/store.mts';
import { brandedEmail, sendMail } from '../lib/mailer.mts';

export const config = { schedule: '*/5 * * * *' };

const list = (v?: string) => String(v || '').split(/[\s,;]+/).filter(Boolean);
const appUrl = () => (process.env.APP_URL || process.env.URL || '').replace(/\/$/, '');

async function probe(st: BlobStore): Promise<string | null> {
  try { await st.get('config/access', { type: 'json' }); } catch (e) { return `Storage can't be read (${(e as Error).message})`; }
  try {
    const r = await fetch(`https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/v2.0/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return `Microsoft sign-in returned ${r.status}`;
  } catch { return "Microsoft sign-in can't be reached"; }
  return null;
}

export function expiries(now = new Date()) {
  const today = Date.parse(ukDay(now));
  return Object.entries(process.env).filter(([k, v]) => k.endsWith('_EXPIRES') && v).map(([k, v]) => {
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(v!);
    return { name: k.replace(/_EXPIRES$/, ''), expires: ok ? v! : null, daysLeft: ok ? Math.round((Date.parse(v!) - today) / 864e5) : null };
  });
}

export async function runHealthCheck(st: BlobStore, now = new Date()) {
  const prev: HealthState | null = await st.get('meta/health', { type: 'json' });
  const problem = await probe(st);
  const failures = problem ? (prev?.failures ?? 0) + 1 : 0;
  const alerts = list(process.env.ALERT_EMAILS);
  let alertedAt = prev?.alertedAt ?? null;

  if (problem && failures >= 2 && (!alertedAt || now.getTime() - Date.parse(alertedAt) > 60 * 60_000)) {
    if (await sendMail({ to: alerts, subject: `${APP_NAME} is having problems`, html: brandedEmail({ heading: `${APP_NAME} is having problems`,
      paragraphs: [problem, `The check has failed ${failures} times in a row. You'll get another email when it's working again.`] }) })) alertedAt = now.toISOString();
  }
  if (!problem && prev && prev.failures >= 2 && alertedAt) {
    await sendMail({ to: alerts, subject: `${APP_NAME} is working again`, html: brandedEmail({ heading: `${APP_NAME} is working again`,
      paragraphs: ['The health check is passing again.'], link: appUrl() ? { href: appUrl(), label: 'Open the app' } : undefined }) });
    alertedAt = null;
  }

  // Credential reminders, at most once per credential per stage
  const exp = expiries(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(now));
  if (hour >= 8 && hour < 18) {
    const sent: Record<string, string[]> = (await st.get('meta/expiry-reminders', { type: 'json' })) || {};
    for (const e of exp) {
      if (e.daysLeft == null) continue;
      const stage = e.daysLeft <= 0 ? 'expired' : e.daysLeft <= 1 ? '1' : e.daysLeft <= 7 ? '7' : e.daysLeft <= 21 ? '21' : null;
      const key = `${e.name}@${e.expires}`;
      if (!stage || sent[key]?.includes(stage)) continue;
      const ok = await sendMail({ to: list(process.env.EXPIRY_EMAILS || process.env.ALERT_EMAILS),
        subject: `${APP_NAME}: ${e.name} ${stage === 'expired' ? 'has expired' : `expires in ${e.daysLeft} day${e.daysLeft === 1 ? '' : 's'}`}`,
        html: brandedEmail({ heading: `${e.name} ${stage === 'expired' ? 'has expired' : 'is about to expire'}`,
          paragraphs: [`${APP_NAME}'s ${e.name} ${stage === 'expired' ? 'expired' : 'expires'} on ${e.expires}.`,
            'Renew it, update its value and its _EXPIRES date in Netlify, then redeploy. See DEPLOYMENT.md.'] }) });
      if (ok) (sent[key] ??= []).push(stage);
    }
    await st.setJSON('meta/expiry-reminders', sent);
  }

  const backup = await st.get('meta/backup', { type: 'json' }) as { day?: string } | null;
  const state: HealthState = { checkedAt: now.toISOString(), ok: !problem, failures, problem, alertedAt, lastBackup: backup?.day ?? null, expiries: exp };
  await st.setJSON('meta/health', state);
  return state;
}

export default async () => {
  const s = await runHealthCheck(store());
  if (!s.ok) console.warn(`Health check failed (${s.failures} in a row): ${s.problem}`);
};
