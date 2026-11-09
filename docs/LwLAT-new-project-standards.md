# LwLAT new project standards

Every new LwLAT web app starts from the **`lwlat-app-template`** repo, which already does almost everything in this file. Use this file for the rules the template can't enforce on its own: the decisions, the checks and the conventions. Where a project needs to do something different, say so at the start.

Template copies (private, identical): `LwLAT-IT-Services/lwlat-app-template` and `Learning-without-Limits-Academt-Trust/lwlat-app-template`. If you change one, push the same commit to the other.

**Pulse** (https://pulse.lwlat.org.uk) is the trust's staff portal and the design reference. Every app links back to it.

---

## 1. Starting a new app

Requests for a new app come in on the form in [REQUESTING-AN-APP.md](REQUESTING-AN-APP.md). Its answers map straight onto the steps below: the name and highlighted word go into `APP_TITLE`, the users and roles into the access rules and Entra groups, the owners into `OWNER_EMAILS`, the fields into the feature, and the personal data and retention answers into the security review (section 5).

1. On GitHub: **Use this template** → a **private** repo in your team's organisation.
2. Rename (the README has the full table): `shared/constants.ts` (`APP_NAME`, `TEAM_NAME`, `SUPPORT_EMAIL`, `OWNER_EMAILS`, `APP_TITLE`, `STORE_NAME`, `RETENTION_DAYS`), `APP_CODE` in `netlify/lib/session.mts`, page titles and `<h1>`s, `package.json`, the favicon glyph.
3. Replace the example **records** feature with the app's own, keeping its patterns (below).
4. Follow `DEPLOYMENT.md` for Entra and Netlify, then the go-live checklist there.
5. Fill in `src/admin/security.ts` (section 5) and make a Pulse thumbnail with the `lwlat-site-thumbnails` skill.

**Don't rebuild what's there.** The template already has: Entra sign-in and the edge gate, roles and the admin portal, View as, the Pulse header, the Pulse button, the settings drawer, the guided tour, the feedback button, CSV export, the skip link, the `/signed-out` page, retention, daily backups, the health check, credential expiry reminders, the mailer, security headers, CI and offline tests. Change them only to fix or improve them, and if you do, make the same change in the template.

### Patterns every feature must follow

| Pattern | Where it lives |
|---|---|
| Check the person's site or role **on the server** for every read and write | `resolveAccess()` / `allowed()` in `netlify/functions/api.mts` |
| Shared writes go through `update()` (conditional put with retries); edits send `expectUpdatedAt` | `netlify/lib/store.mts` |
| The server stamps who and when. Clients can't change `createdAt`/`createdBy` | `saveRecord()` |
| Every change goes in the change log | `audit()` |
| Escape everything shown on a page | `esc()` in `src/lib/dom.ts` |
| Colours from tokens (`--accent`, `--bg`, `--text`, `--ok-*`…), never hard-coded hex in the app body | `src/styles/tokens.css` |
| Demo data in `mock.ts` (compiled out of production), plus tests with fakes for every service | `src/*/mock.ts`, `tests/` |
| New page: add it to `vite.config.ts` inputs, a `netlify.toml` redirect and a tour | |

---

## 2. Stack rules

- TypeScript everywhere; Vite MPA; no framework unless needed (never Next.js or React for an internal tool).
- Netlify on the trust's Netlify account, auto-deploying from `main`. If you (or Claude) can't change the site settings yourself, give the values to whoever administers that account rather than guessing.
- Netlify Blobs in the EU, reached only through the app's API. Never change the region or `STORE_NAME` once there's live data.
- Node 22.18+. Tests use `node --test`; add Playwright only for real browser tests.
- As few dependencies as possible. Use Web Crypto, not libraries. Self-host any browser library in `public/vendor/<name>-<version>/` with its licence (school web filters block CDNs). Google Fonts is the one allowed exception.
- Secrets live only in Netlify environment variables, scoped to Functions and marked secret. Redeploy after changing one. Every secret has a `<NAME>_EXPIRES` variable.
- Scheduled functions run only on the published production deploy.

---

## 3. Design decisions

The template already has the Pulse look. These are the rules for anything new.

- **Font:** Open Sans only (Google Fonts, as Pulse). Emails use Arial.
- **Colours:** teal `#009F9A`, deep `#00524E`, night `#003B39`, lime `#ACCE33` (the signature accent), sun `#F5BA19`, berry `#E0218A`, plum `#6F2789`, ink `#14302F`.
  - Brand Guidelines v1.0 adds mission teal `#098F88`, darkest teal `#00706A`, dark green `#73A434` and red `#CE153F`.
- **Contrast:** never put small white text on `#009F9A` or mission teal (under 4.5:1). Use `#00706A` or darker. Small text goes only in darkest teal, grey or near-black. Lime is for large words on dark backgrounds.
- **Title:** heavy type with the key word in lime (`<h1>App <span class="mint">Name</span></h1>`). Eyebrow: the team that runs the app (for example "LwLAT IT Services"). Always write **LwLAT** exactly like that, never "LWLAT" or "lwlat" (lower case only inside email addresses, web addresses and code names), and the full name as **Learning without Limits Academy Trust**. Don't use CSS `text-transform: uppercase` on any text that could contain LwLAT.
- **Buttons:** pill-shaped. Selected state is a lime pill with ink text. Focus ring always visible.
- **British English**, `lang="en-GB"`, DD/MM/YYYY dates, `Europe/London` time. School years run 1 September to 31 August (`2025-26`).

### Logos and icons (all in the template's `public/`)

| File | Use |
|---|---|
| `assets/logo_white.png` | White Trust logo on teal headers (alt "Learning without Limits Academy Trust") |
| `assets/lwlat-trust-colour.png` | Full-colour Trust logo on white (web, emails) |
| `assets/brand/lwlat-logo-colour-master.png`, `assets/brand/lwlat-logo-white-master.png` | High-resolution Trust masters (2000px+) for print, thumbnails and slides. Too large for web pages |
| `assets/sites/<code>.png` | Academy logos in colour (`lwl.png` is the Trust) |
| `assets/sites/<code>-white.png` | Academy logos in white, for teal backgrounds |
| `assets/sites/<code>-wide.png` | Academy mark with the academy's name in white, for teal or dark backgrounds (for the Trust use `logo_white.png`) |
| `assets/sites/<code>-mark.png` | Small academy marks for chips and tags (`lwl-mark.png` is the Trust feather) |
| `favicon.svg`, `apple-touch-icon.png` | Pulse-line icon. Change the glyph per app; keep the teal tile and lime dot |

### Sites: 5 academies and the trust

The trust (LwLAT) has 5 academies. Apps treat each academy and the trust's central team as a "site".

| Code | Site | Email domain |
|---|---|---|
| `BAB` | Babington Academy | `babington.lwlat.org.uk` |
| `SWH` | South Wigston High School | `southwigston.lwlat.org.uk` |
| `LAN` | Lancaster Academy | `lancaster.lwlat.org.uk` |
| `WOO` | Woodstock Primary Academy | `woodstock.lwlat.org.uk` |
| `HEA` | Heatherbrook Primary Academy | `heatherbrook.lwlat.org.uk` |
| `LWL` | LwLAT Central (the trust itself, not an academy) | `lwlat.org.uk` |

- Domains match exactly. Old domains (for example `*.leicester.sch.uk`) can identify an academy but never grant access.
- Tenant ID: `feea94a4-0457-4b54-a46d-ab8d16be93fa`. Use these codes in every app.

### Emails

Use `brandedEmail()` in `netlify/lib/mailer.mts`: tables, inline styles, 600px, Arial, PNG logos.
- Keep personal details out of emails. Link to the record instead, so it opens through sign-in.
- Email failures never block the action.

---

## 4. Per-app work the template can't do

- **Accessibility:** WCAG 2.2 AA in light, dark and every theme. Real buttons, `aria-label` on icon-only buttons, `aria-live` for status changes, 24px touch targets, and it works at phone width and 150% zoom. Dashboards also offer an Okabe–Ito palette, Atkinson Hyperlegible and tables instead of charts, and are checked with axe-core.
- **Tour:** write steps for the app's own pages, skipping things the person can't use.
- **Print styles** for anything people print (hide the header, single A4 pages for one record).
- **Imports** from CSV or Excel are parsed in the browser, previewed with warnings, and only the needed columns sent.
- **Version history** (last 30 saves, with restore) for anything admins publish, such as timetables or menus.
- **Cookies:** no banner while the app sets only the session cookies and the person's own settings. Analytics, tracking or third-party embeds need an opt-in banner **and** DPO sign-off first.

### Special cases

The examples are existing trust apps that already do this. Their repos are private, so ask the team that owns them for access or a copy of the relevant code.

| Need | How | Example app |
|---|---|---|
| Background job or on-site script calling the API | Its own app registration, a certificate, and an app role such as `Tracker.Sync`, checked in the gate and the API. Never a shared key | starter tracker `/api/sync/*` |
| Teams tab | `SameSite=None; Partitioned` cookies in the frame; `frame-ancestors` limited to Teams | starter tracker |
| People without a Microsoft account | Per-person passwords, salted-hashed, time-boxed, locked after 8 failures for 10 minutes. DPO first | Trip Planner |
| Open public form | Requester's own details only, a hidden spam trap, a rate limit, and the admin side behind sign-in | hospitality |
| An app role as a second check | `<App>.<Role>` app role required in the ID token | HR KPIs |

Never use a shared `ADMIN_PASSWORD`, MSAL in the browser, or tenant-wide Graph `Mail.Send`.

---

## 5. Security review (before go-live)

Answer each question in `src/admin/security.ts` with evidence (files and tests) and the date. It's a review record, not a penetration test. Update it when the app changes. The template already covers the ones marked ✓; check them still hold after your changes.

**Identity and access**
1. ✓ Entra only, with PKCE, state, nonce, audience, issuer and tenant checks?
2. ✓ Every page and API route behind the gate, failing closed? What else is public, and why?
3. Permissions checked on the server for **every new route**? Can a site admin reach another site's data or change their own access? (Write tests for both.)
4. ✓ Signed, HttpOnly, Secure, SameSite cookies, 8 hours?
5. Sensitive files (documents, artwork, screenshots) served only through an access-checked API, never from `/assets`?
6. Assignment required and MFA on? How is access removed, and how fast?

**Requests and browser**
7. ✓ CSRF: Origin and JSON required on writes?
8. Everything displayed escaped? Any CSP exception justified and documented (never `'unsafe-eval'`)?
9. ✓ Security headers. 10. ✓ No CORS. 11. Rate limits on any new expensive or emailing route?

**Secrets, deployment and data**
12. ✓ Credentials server-side only; only `dist/` published, with no source maps?
13. ✓ Demo mocks compiled out; dev bypass only under `CONTEXT=dev`?
14. Git history scanned for secrets, keys, `.env` files or spreadsheets?
15. `npm audit` clean; no unused packages; vendored libraries pinned and licensed?
16. Deploy previews off or limited, with team-login protection on?
17. Netlify environment confirmed by an admin: no `AUTH_DEV_EMAIL` or `SEED_DEMO`, the tenant GUID set, secrets marked, expiries recorded?
18. Netlify team membership kept small? (Anyone on the site can read its storage.)
19. Retention period agreed, and deletion actually scheduled for the app's data?
20. ✓ Backups. Has a restore been tried?
21. ✓ Monitoring. Are `ALERT_EMAILS` set, with email working?
22. Any stored credential (for example a print code) AES-256-GCM encrypted, never in lists or exports, revealed one at a time and logged?
23. No SQL database (or, if there is one, parameterised queries)? Storage keys validated by the server?
24. ✓ Concurrency. Do new writes use `update()`?
25. ✓ Audit trail. Do new actions call `audit()`? Are removals kept with a reason?

**Data protection**
26. What personal data is stored? Has the DPO cleared it (with a DPIA if needed), and is it in the record of processing?
27. No pupil data without a signed-off DPIA. Never passwords, dates of birth, NI numbers, salaries or contract details.
28. Photos and spreadsheets processed in the browser where possible, never uploaded, and cleared after use?
29. No names sent to GitHub, Freshservice or other services unless DPO-cleared? Logs hold counts and codes only?
30. ✓ No cookie banner needed (no non-essential cookies)?

---

## 6. Integrations

Every integration runs server-side only, has a fake in `tests/`, and stays switched off (with a message in the page) until its variables are set.

| Service | Rules |
|---|---|
| **Microsoft Graph** | App-only, minimum application permissions, documented in `CLAUDE.md` with the date granted. Cache tokens; retry once on 403 with a fresh token. |
| **Sending / reading mail** | A separate app with Exchange RBAC for Applications scoped to one mailbox ("Application Mail.Send" / "Mail.Read"). Check with `Test-ServicePrincipalAuthorization`; it takes about 2 hours to apply. Over 3 MB needs an upload session. |
| **Freshservice** | Requester is the signed-in person; routing assigns the group. Resolve fields by visible name and cache them for 24 hours. Reports use `GET` only and drop names and text as each page arrives. Wait for `Retry-After` on 429. |
| **SalamanderSoft** | `Salamander@lwlat.org.uk`, staff reports only. **Never** pupil reports. |
| **SIMS (SGA Azure Blob)** | Read + List HTTPS-only SAS with an expiry, never the account key. Allow-list folders (the account holds pupil data). HMAC the IDs. |
| **Net2/Paxton, Sign In App, PaperCut, Dell** | Working clients and test fakes exist in IT Services' fob register and new starter tracker; ask IT Services before writing new ones. Never keep card or token numbers. |
| **GitHub (feedback)** | Fine-grained token for one repo, Issues only, renewed yearly. Built into the template. |

---

## 7. Working conventions (for Claude)

- **Commit locally; never push to GitHub until the project owner says so.** If GitHub refuses a push with "would publish a private email address" (GH007), set the repo's commit email to your GitHub no-reply address (GitHub → Settings → Emails): `git config user.email "<id>+<username>@users.noreply.github.com"`.
- Set `OWNER_EMAILS` to the app's owners, so at least two people can never be locked out.
- British English in the UI, docs and commits.
- Keep `README.md`, `DEPLOYMENT.md` and a short `CLAUDE.md` (status with dated "confirmed on live" notes, and what isn't verified yet).
- On the trust network: `$env:NODE_OPTIONS="--use-system-ca"`. Don't edit files with PowerShell 5.1 `Set-Content`; use the Edit tool. Task Scheduler scripts can't use `$PSScriptRoot` in `param()`.
- One-off data changes (migrations, resets, backfills) get a new dated id each time, recorded as run. Never edit or reuse one.
- Server-written fields can't be changed by the client. Append to history; never replace it.

---

## 8. Keeping Claude usage down

**You:** one task per session (`/clear` when switching), close finished sessions, `/compact` for long tasks, and `/context` to see what's filling a session. Choose the model with `/model`:

| Task | Model |
|---|---|
| Small edits, renames, running commands | Haiku or Sonnet, low effort |
| Features, fixes, tests, docs | Sonnet, medium |
| New app set-up, sign-in and security work, tricky bugs | Opus, high |

Name the file and paste the error. Group small changes into one message. Ask for workflows or many agents only when really needed.

**Claude:**
- Start from the template, never from scratch.
- Search before reading; read only the lines needed.
- Use subagents only when really needed: Haiku for searching, Sonnet for routine coding, Opus for review and security.
- Skip `node_modules`, `dist`, lock files and `public/vendor`.
- Run one test file while working, and `npm run check` once at the end.
- Make small edits, and say when a fresh session or a smaller model would be cheaper.
