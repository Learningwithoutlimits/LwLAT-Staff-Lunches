// Email through Microsoft Graph, from one shared mailbox (MAIL_SENDER).
//
// A SEPARATE app registration ("LwLAT – <App> Mailer") uses the client credentials flow. Its right to send
// comes from Exchange Online RBAC for Applications ("Application Mail.Send" scoped to MAIL_SENDER only).
// Don't grant tenant-wide Graph Mail.Send: that would let the app send as anyone. See DEPLOYMENT.md.
//
// Email is off until MAIL_CLIENT_ID, MAIL_CLIENT_SECRET and MAIL_SENDER are all set. Failures are logged with
// the status code only (no token, addresses or body) and never throw, so they can't block the action itself.

let cached: { token: string; exp: number } | null = null;

export const mailOn = () => !!(process.env.MAIL_CLIENT_ID && process.env.MAIL_CLIENT_SECRET && process.env.MAIL_SENDER && process.env.ENTRA_TENANT_ID);

async function token(fresh = false) {
  if (!fresh && cached && cached.exp > Date.now() + 5 * 60_000) return cached.token;   // reuse until 5 minutes before expiry
  const res = await fetch(`https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.MAIL_CLIENT_ID!, client_secret: process.env.MAIL_CLIENT_SECRET!,
      grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' }),
  });
  const j = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`token ${res.status} ${j.error ?? ''}`.trim());
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export interface Mail { to: string[]; subject: string; html: string; replyTo?: string }

/** Send one email. Returns true if Graph accepted it. */
export async function sendMail(m: Mail): Promise<boolean> {
  if (!mailOn() || !m.to.length) return false;
  const body = JSON.stringify({
    message: { subject: m.subject, body: { contentType: 'HTML', content: m.html },
      toRecipients: m.to.map(address => ({ emailAddress: { address } })),
      ...(m.replyTo ? { replyTo: [{ emailAddress: { address: m.replyTo } }] } : {}) },
    saveToSentItems: true,
  });
  try {
    for (const fresh of [false, true]) {   // a token issued before a permission was granted never gains it: retry once with a fresh one
      const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.MAIL_SENDER!)}/sendMail`, {
        method: 'POST', headers: { authorization: `Bearer ${await token(fresh)}`, 'content-type': 'application/json' }, body });
      if (res.ok) return true;
      if (res.status !== 403 && res.status !== 401) { console.warn(`Email not sent: Graph ${res.status}`); return false; }
    }
    console.warn('Email not sent: Graph refused permission (check the Exchange RBAC scope)');
  } catch (e) { console.warn('Email not sent:', (e as Error).message); }
  return false;
}

import { TEAM_NAME } from '../../shared/constants.ts';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * A plain branded email that works in classic Outlook: tables, inline styles, 600px, Arial.
 * Keep personal details out of emails; link to the record instead, so it opens through sign-in.
 */
export function brandedEmail({ heading, paragraphs, link }: { heading: string; paragraphs: string[]; link?: { href: string; label: string } }) {
  return `<!doctype html><html lang="en-GB"><body style="margin:0;background:#F6FAF9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6FAF9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:14px;font-family:Arial,Helvetica,sans-serif;color:#14302F">
<tr><td style="background:#003B39;border-radius:14px 14px 0 0;padding:20px 28px;color:#ffffff;font-size:20px;font-weight:bold">${esc(heading)}</td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.5">
${paragraphs.map(p => `<p style="margin:0 0 14px">${esc(p)}</p>`).join('')}
${link ? `<p style="margin:20px 0 0"><a href="${esc(link.href)}" style="display:inline-block;background:#ACCE33;color:#14302F;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">${esc(link.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #D5E6E4;font-size:12px;color:#4E6866">Learning without Limits Academy Trust · ${esc(TEAM_NAME)}</td></tr>
</table></td></tr></table></body></html>`;
}
