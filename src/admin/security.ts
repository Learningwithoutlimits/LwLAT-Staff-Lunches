// Admin → Security review: a dated review record (not a live scanner or a certification), plus the live
// health, backup and credential-expiry status from the scheduled health check.
// TEMPLATE: before go-live, check every control against the real app, update the evidence, and set RECORDED.
// Update it whenever the app changes. The questions come from docs/LwLAT-new-project-standards.md section 5.
import type { HealthState } from '../../shared/types.ts';
import { ukDateTime } from '../../shared/constants.ts';
import { esc } from '../lib/dom.ts';

const RECORDED = 'TODO: date reviewed';   // e.g. '4 November 2026'

interface Control { title: string; detail: string; evidence: string; status?: 'In place' | 'To check' }
const groups: { title: string; intro: string; controls: Control[] }[] = [
  { title: 'Identity & access', intro: 'Microsoft sign-in and server-side permissions protect the app.', controls: [
    { title: 'Microsoft Entra sign-in', detail: 'Confidential client with PKCE, state and nonce. The ID token comes from Microsoft\'s token endpoint and is checked for audience, issuer, tenant, nonce and expiry. Only allowed email domains get in.', evidence: 'functions/auth.mts · auth tests' },
    { title: 'Every route behind the gate', detail: 'The edge gate requires a session for every page, script and API route. Only the sign-in page, its own assets, /auth/*, /signed-out, logos and robots.txt are public. It fails closed without SESSION_SECRET.', evidence: 'edge-functions/gate.ts · gate tests' },
    { title: 'Permissions on the server', detail: 'Every API request re-checks access. Site checks apply to every read and write; a site admin can\'t reach another site\'s data or change their own access.', evidence: 'functions/api.mts · lib/config.mts · cross-site and site-admin tests' },
    { title: 'Signed sessions', detail: 'HMAC-SHA256 signed cookie, HttpOnly, Secure, SameSite=Lax, 8 hours. No tokens in the browser. Sign-out also ends the Microsoft session.', evidence: 'lib/session.mts · session tests' },
    { title: 'Assignment and MFA', detail: 'Enterprise app has Assignment required = Yes; MFA by Conditional Access. Removing someone blocks their next sign-in; rotating SESSION_SECRET signs everyone out.', evidence: 'Entra (confirmed by admin)', status: 'To check' },
  ] },
  { title: 'Requests & browser protections', intro: 'Controls against forged requests, injected content and abusive traffic.', controls: [
    { title: 'Cross-site request protection', detail: 'Write requests need the site\'s own Origin and a JSON body.', evidence: 'functions/api.mts · CSRF tests' },
    { title: 'Content injection protection', detail: 'Displayed data is escaped (esc). The CSP allows scripts from this site only, with no inline scripts and no eval.', evidence: 'lib/dom.ts · netlify.toml' },
    { title: 'Security headers', detail: 'HSTS, CSP, frame-ancestors none, nosniff, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy and noindex.', evidence: 'netlify.toml · function responses' },
    { title: 'No CORS', detail: 'The API never opts in to cross-origin access.', evidence: 'functions/api.mts' },
    { title: 'Rate limits & refusal logging', detail: 'Per-IP limits on the API and sign-in. Refused requests and failed sign-ins are logged; feedback is limited per person.', evidence: 'functions/api.mts · functions/auth.mts' },
  ] },
  { title: 'Secrets, deployment & data', intro: 'Credentials stay on the server, with checks around stored records.', controls: [
    { title: 'Server-side credentials', detail: 'Entra, mail and GitHub credentials are used only by server functions. Only dist/ is published, with no server source or source maps.', evidence: 'netlify.toml · vite.config.ts' },
    { title: 'Development features', detail: 'Demo mocks are compiled out of production builds. The local sign-in bypass needs CONTEXT=dev.', evidence: 'lib/auth.mts · gate.ts · Vite modes' },
    { title: 'Repository hygiene', detail: '.env, dist, node_modules, .netlify and spreadsheets are git-ignored. Scan the history for secrets before go-live.', evidence: '.gitignore', status: 'To check' },
    { title: 'Dependencies', detail: 'One runtime dependency (@netlify/blobs). npm audit should report zero vulnerabilities.', evidence: 'package.json', status: 'To check' },
    { title: 'Storage, concurrency & audit', detail: 'Netlify Blobs (EU) through the API only. Conditional writes, so two people saving at once can\'t overwrite each other. Who and when are stamped by the server; the change log can\'t be edited from the page.', evidence: 'lib/store.mts · concurrency tests' },
    { title: 'Retention & backups', detail: 'Staff removed from a list, and change-log entries, are deleted after the retention period. Daily backups are kept 30 days in a separate store.', evidence: 'functions/retention.mts · functions/backup.mts' },
  ] },
  { title: 'Data protection', intro: 'What personal data the app holds, and who has agreed it.', controls: [
    { title: 'Personal data', detail: 'Staff names, job titles, work emails (optional) and free-lunch weekdays, per site. No pupil data. Imports are read in the browser and only those columns are sent. TODO: DPO clearance and record of processing entry.', evidence: 'DPO (date)', status: 'To check' },
    { title: 'No pupil data or sensitive identifiers', detail: 'No pupil data, passwords, dates of birth, NI numbers or contract details are stored.', evidence: 'shared/types.ts' },
    { title: 'Cookies', detail: 'Only strictly necessary cookies (session and sign-in) and settings the person chose. No analytics or tracking, so no consent banner is needed.', evidence: 'lib/session.mts · lib/settings.ts' },
    { title: 'Nothing personal to third parties', detail: 'Feedback issues on GitHub carry no names or emails; emails carry no personal details beyond the recipient.', evidence: 'lib/github.mts · lib/mailer.mts' },
  ] },
];

const environment = [
  ['Local sign-in bypass', 'AUTH_DEV_EMAIL is absent from production.'],
  ['Demo data', 'SEED_DEMO is removed for production.'],
  ['Tenant restriction', 'ENTRA_TENANT_ID is the tenant GUID, so the tenant check applies.'],
  ['Secret handling', 'Every secret is marked as secret and scoped to Functions, with its expiry recorded.'],
  ['Deploy previews', 'Off, or one fixed branch deploy, with Netlify team-login protection on.'],
];

function healthCard(h: HealthState | null) {
  if (!h) return `<div class="card"><h2>Live status</h2><p class="sub">The health check hasn't run yet. It runs every 5 minutes on the published site.</p></div>`;
  const exp = h.expiries.map(e => `<li><b>${esc(e.name)}</b>: ${e.expires ? `${esc(e.expires)} (${e.daysLeft! < 0 ? 'expired' : `${e.daysLeft} days`})` : 'not a valid date'}</li>`).join('');
  return `<div class="card"><div class="chead"><div><h2>Live status</h2><p class="sub">Checked ${esc(ukDateTime(h.checkedAt))}</p></div>
    <span class="security-status">${h.ok ? 'Working' : 'Problem'}</span></div>
    <ul>${h.ok ? '' : `<li><b>Problem:</b> ${esc(h.problem)} (${h.failures} checks in a row)</li>`}
    <li><b>Last backup:</b> ${esc(h.lastBackup ?? 'none yet')}</li>${exp || '<li>No credential expiry dates set (add <span class="mono">*_EXPIRES</span> variables).</li>'}</ul></div>`;
}

export function renderSecurityReview(container: HTMLElement, health: HealthState | null) {
  const total = groups.reduce((n, g) => n + g.controls.length, 0);
  container.innerHTML = `
    <div class="card security-intro">
      <div class="chead"><div><span class="security-eyebrow">Governance & assurance</span><h2>Security review</h2>
        <p class="sub">A readable record of the application review and deployment checks.</p></div><span class="chip">Recorded ${esc(RECORDED)}</span></div>
      <div class="security-summary">
        <div><strong>${total}</strong><span>Documented controls</span></div>
        <div><strong>${environment.length}</strong><span>Environment checks</span></div>
        <div><strong>Review record</strong><span>Updated when the application changes</span></div>
      </div>
      <p class="security-note">Review method: code review supported by automated access and request-handling tests. This record is not an independent penetration test, and it doesn't read secret values.</p>
    </div>
    ${healthCard(health)}
    <div class="security-groups">${groups.map(g => `<div class="card"><h2>${esc(g.title)}</h2><p class="sub">${esc(g.intro)}</p>
      <div class="security-controls">${g.controls.map(c => `<details class="security-control"><summary><span>${esc(c.title)}</span><span class="security-status">${c.status ?? 'In place'}</span></summary>
        <div><p>${esc(c.detail)}</p><p class="security-evidence">Evidence: ${esc(c.evidence)}</p></div></details>`).join('')}</div></div>`).join('')}</div>
    <div class="card"><div class="chead"><div><h2>Netlify environment checks</h2><p class="sub">Confirmed by an admin, never by reading the values</p></div></div>
      <div class="security-checks">${environment.map(([t, d]) => `<div><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</div>
    </div>`;
}
