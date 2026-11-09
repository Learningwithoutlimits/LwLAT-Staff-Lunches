# Staff Free Lunches

A Learning without Limits Academy Trust dashboard showing which staff get a free lunch, and on which days from Monday to Friday, at each of the 5 academies and LwLAT Central. Built from `lwlat-app-template`.

- **Dashboard:** a card per site (today's number and a bar per weekday), a searchable staff table, a printable day list for the kitchen, and CSV export.
- **Manage staff** (admins and site admins, for their own sites): import the full staff list from CSV, add or remove people, and switch each person's free-lunch days on or off. Every change is stamped and logged.

The rest of this file is the template's own guide.

## About the template

The starting point for every new LwLAT web app. It already has everything the standards in [docs/LwLAT-new-project-standards.md](docs/LwLAT-new-project-standards.md) require, so a new project only needs its own feature.

**What's built in**

- Microsoft Entra sign-in (server-side, PKCE, tenant check) with an edge gate in front of every page and API route
- Roles (Admin, Central, Site admin, Site, Blocked) by person, Entra group or email domain, checked on the server on every request
- The Pulse look: teal header, white Trust logo, lime key word, Open Sans, pill buttons
- **Back to Pulse** button, **Settings** drawer (light/dark/system, 7 themes, text size, zoom, contrast, reduced motion) and a guided tour
- Admin portal: people and access, sites and rules, sign-ins (including people turned away), change log, **View as**, security review with live status
- **Feedback** button that opens GitHub issues without sending names
- Scheduled jobs: retention purge, daily backups (30 days) with a restore script, health check with outage emails and credential expiry reminders
- Email through Microsoft Graph from a shared mailbox, scoped by Exchange RBAC
- CSV export with formula escaping, skip link, `/signed-out` page, security headers, CI and offline tests

The **records** list on the home page is a worked example of a per-school feature. Replace it with the real thing.

## Starting a new app

1. On GitHub, choose **Use this template → Create a new repository**. Make it **private**, in `LwLAT-IT-Services` (or `Learningwithoutlimits`).
2. Clone it and change these:

   | Where | What |
   |---|---|
   | `shared/constants.ts` | `APP_NAME`, `TEAM_NAME`, `SUPPORT_EMAIL`, `OWNER_EMAILS`, `APP_TITLE`, `STORE_NAME` (never change once live), `RETENTION_DAYS` |
   | `netlify/lib/session.mts` | `APP_CODE`, a short code for cookie names (e.g. `fr`, `nst`) |
   | `index.html`, `admin.html`, `login.html` | `<title>`, the `<h1>` / `.htitle` words, the header eyebrow (team name), the login page's description and support email |
   | `package.json` | `name`, `description` |
   | `public/favicon.svg` | The app's own white glyph on the teal tile |
   | `src/admin/security.ts` | Fill in the TODOs and the `RECORDED` date before go-live |

3. Replace the records example (`shared/types.ts`, `netlify/lib/store.mts`, `netlify/functions/api.mts`, `src/home/`, `tests/`) with the app's feature, keeping its patterns: site checks on the server, `update()` for shared writes, `audit()` for changes, `esc()` for display.
4. Follow [DEPLOYMENT.md](DEPLOYMENT.md) for Entra and Netlify.
5. Make a Pulse thumbnail with the `lwlat-site-thumbnails` skill.

## Local development

Node 22.18 or newer. On the trust network, run `$env:NODE_OPTIONS="--use-system-ca"` first (the web filter inspects HTTPS).

```bash
npm install
npm run demo        # http://localhost:5173: pages with in-memory demo data, no sign-in, nothing saved
npm run local       # real API code, signed in as AUTH_DEV_EMAIL (default alex.taylor@lwlat.org.uk, a demo admin), data resets on restart
npm test            # automated tests, no accounts needed
npm run check       # typecheck + tests + production build (what CI runs)
npm run dev         # full app via netlify dev on :8888 (needs netlify-cli and a .env, see .env.example)
```

`/admin?siteadmin` in `npm run demo` previews the portal as a site admin.

## Layout

```
index.html, admin.html, login.html   pages (login.html also serves /signed-out)
src/home/  src/admin/  src/login/    one folder per page: main.ts, api.ts, mock.ts (demo only), tour.ts
src/lib/                             dom (esc), http, pulse, settings, palette, tour, feedback
src/styles/                          tokens.css → ui.css → home.css / admin.css / login.css
shared/                              types, constants, csv: used by browser and server
netlify/edge-functions/gate.ts       sign-in gate for every route
netlify/functions/                   auth, api, retention (daily), backup (hourly), health-check (5 minutes)
netlify/lib/                         session, auth, config (access rules), store, mailer, github, seed
scripts/backup.mts                   list / show / restore backups from a PC
tests/                               node --test, with Blobs, Microsoft and GitHub simulated
docs/                                the LwLAT standards, and the form for requesting a new app
```

## Security notes

- Sessions are HMAC-signed cookies (`HttpOnly; Secure; SameSite=Lax`, 8 hours). No tokens in the browser.
- Every API call re-checks access on the server. Hiding things in the page is never relied on.
- Writes must come from the site's own origin as JSON (CSRF). The CSP allows no inline scripts.
- Shared writes use conditional puts with retries, so two people saving at once can't overwrite each other.
- Only `dist/` is published, with no source maps. Demo mocks are compiled out of production builds.
- See Admin → Security review for the full, dated record.
