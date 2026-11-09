# CLAUDE.md

LwLAT app template. Standards: `docs/LwLAT-new-project-standards.md` (read the section you need, not the whole file). Setup: `README.md`. Entra/Netlify: `DEPLOYMENT.md`.

## Architecture (short)

- TypeScript + Vite MPA; Netlify Functions (`netlify/functions/*.mts`) behind an edge gate (`netlify/edge-functions/gate.ts`); Netlify Blobs (EU) via `netlify/lib/store.mts` only.
- Access: `netlify/lib/config.mts` `resolveAccess()`, re-checked in `api.mts` on every request. Never rely on hiding things in the page.
- Shared writes: `update()` (conditional put + retry). Changes: `audit()`. Display: `esc()`. Types shared in `shared/types.ts`.
- `mock.ts` files are demo-only and compiled out of production.

## Rules

- Commit locally; never push until the project owner says so. British English everywhere.
- Keep the CSP strict (no inline scripts, no third-party script hosts, never `'unsafe-eval'`).
- Never store pupil data, passwords, dates of birth, NI numbers or contract details.
- One-off data changes get a new dated id; never edit or reuse one.
- Run one test file while working; `npm run check` once at the end.
- On the trust network: `$env:NODE_OPTIONS="--use-system-ca"`. Don't edit files with PowerShell 5.1 `Set-Content`.

## Status

- **Purpose:** Staff Free Lunches. A trust dashboard of which staff get a free lunch, Monday to Friday, at each of the 5 academies and LwLAT Central. Admins and site admins import each site's full staff list (CSV, parsed in the browser) and set each person's days on the **Manage staff** tab. Everyone else with access to a site sees its dashboard read-only, can print a day list for the kitchen and export CSV.
- **Data:** `staff/<SITE>` → `StaffMember[]` (`shared/types.ts`). Removed staff are kept with a reason and deleted by retention `RETENTION_DAYS` after removal. Imports match people by work email, or by name when there's no email.
- **Routes:** `POST /api/staff/{days,add,remove,import}` need `access.manage` to include the site (admins: all; site admins: theirs). Tested in `tests/app.test.mts`.
- 06/11/2026: built from the template (955ecc1). `npm run check` passes (19 tests); checked in `npm run demo` (dashboard, day toggles, import, phone width). **Nothing deployed yet.**
- Not done / to confirm: Entra app registration and Netlify site (`DEPLOYMENT.md`); a second owner in `OWNER_EMAILS`; `TEAM_NAME` and `SUPPORT_EMAIL`; retention period with the DPO (currently 5 years); DPO sign-off on staff names/emails; security review date in `src/admin/security.ts`; Pulse thumbnail. Excel (.xlsx) import isn't supported: people save as CSV.
