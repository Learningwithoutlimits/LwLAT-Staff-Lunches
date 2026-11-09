# Deployment: Microsoft Entra ID and Netlify

Replace `<App>` with the app's name and `<host>` with its address (e.g. `lwlat-fob-register.netlify.app`, or the custom domain).

## 1. How access is protected

| Layer | What it does |
|---|---|
| Entra ID (single tenant) | Only accounts in tenant `feea94a4-0457-4b54-a46d-ab8d16be93fa` can sign in. **Assignment required** limits this to the users and groups assigned to the enterprise app. |
| Sign-in (`functions/auth.mts`) | Auth code flow with PKCE (S256), state and nonce. The code is redeemed server-side with the client secret. The ID token's audience, issuer, tenant, nonce and expiry are checked, and the email domain against `ALLOWED_EMAIL_DOMAINS`. |
| Session | HMAC-signed `<code>_session` cookie: HttpOnly, Secure, SameSite=Lax, 8 hours (`SESSION_HOURS`). No tokens in the browser. |
| Edge gate (`edge-functions/gate.ts`) | Runs before every request. Only the sign-in page and its assets, `/auth/*`, `/signed-out`, logos and `robots.txt` are public. Fails closed without `SESSION_SECRET`. |
| API (`functions/api.mts`) | Re-checks the session and the person's access on every request. Write requests need the site's own Origin and JSON. |

## 2. Entra app registration

Entra admin centre → **App registrations → New registration** (needs an Application Administrator):

- **Name:** `LwLAT – <App>`. **Supported account types:** single tenant.
- **Platform: Web** (never Single-page application: this is a confidential client).
- **Redirect URIs** (Authentication → Web). Entra needs the post-logout address too, and doesn't accept wildcards:

  | Environment | Redirect URIs |
  |---|---|
  | Production | `https://<host>/auth/callback` and `https://<host>/signed-out` |
  | Custom domain | the same two on that domain |
  | Local (`netlify dev`) | `http://localhost:8888/auth/callback` and `http://localhost:8888/signed-out` |

- **Front-channel logout URL:** blank. **Implicit grant:** both boxes unticked. **Allow public client flows:** No.
- **API permissions:** Microsoft Graph delegated `openid`, `profile`, `email`, then **Grant admin consent**. Add `User.Read` only if the app calls Graph as the user. Never `offline_access`.
- **Token configuration:** add the optional claim **email** to the ID token.
- **Groups (optional):** only if you use Entra group rules in Admin → Sites & rules: Token configuration → Add groups claim → Security groups.
- **Client secret:** Certificates & secrets, 12 months or less. Paste it straight into Netlify. Record the expiry in the trust's risk register and as `ENTRA_CLIENT_SECRET_EXPIRES`.
- **Enterprise application → Properties → Assignment required = Yes.** Assign security groups (not distribution lists) or named people. Optionally set the Home page URL to `https://<host>/auth/login` for a My Apps tile.
- **Conditional Access (recommended):** a policy requiring MFA for this app.

## 3. Netlify

1. **Add new site → Import an existing project → GitHub**, on LwLAT's central Netlify account. Build settings come from `netlify.toml`. (The Netlify connector in Claude Code can't see this account, so enter values by hand.)
2. **Environment variables** (Site configuration → Environment variables). Scope them to **Functions** (this covers the edge gate), tick **Contains secret values** for secrets, and **redeploy** after any change:

   | Variable | Value | Secret |
   |---|---|---|
   | `ENTRA_TENANT_ID` | `feea94a4-0457-4b54-a46d-ab8d16be93fa` | No |
   | `ENTRA_CLIENT_ID` | Application (client) ID | No |
   | `ENTRA_CLIENT_SECRET` | Client secret value | **Yes** |
   | `ENTRA_CLIENT_SECRET_EXPIRES` | `YYYY-MM-DD` | No |
   | `SESSION_SECRET` | 32+ random characters, different for every app (see below) | **Yes** |
   | `ENTRA_DOMAIN_HINT` | `lwlat.org.uk` | No |
   | `ADMIN_EMAILS` | Extra admins, comma-separated (the owners in `shared/constants.ts` are built in) | No |
   | `ALLOWED_EMAIL_DOMAINS` | Optional, default `lwlat.org.uk` (includes school subdomains) | No |
   | `SESSION_HOURS` | Optional, 1–12, default 8 | No |
   | `APP_URL` | The custom domain, once there is one | No |
   | `MAIL_CLIENT_ID`, `MAIL_CLIENT_SECRET`, `MAIL_SENDER` | Email (section 4). Off until all three are set | Secret: **Yes** |
   | `MAIL_CLIENT_SECRET_EXPIRES` | `YYYY-MM-DD` | No |
   | `ALERT_EMAILS`, `EXPIRY_EMAILS` | Who gets outage alerts and credential reminders | No |
   | `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_TOKEN_EXPIRES` | Feedback button (section 5) | Token: **Yes** |
   | `SEED_DEMO` | `true` for testing only. **Remove for production** | No |
   | `AUTH_DEV_EMAIL` | **Never set in production** | No |

   Generate `SESSION_SECRET` in PowerShell:
   ```powershell
   $b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
   ```
   Rotating it and redeploying signs everyone out at once.
3. **Deploy previews:** turn them off (they get a new address each time, so they can't sign in), or use one fixed branch deploy with its own redirect URIs. Keep Netlify team-login protection on for non-production deploys.
4. Blobs is created automatically, in the EU (Frankfurt). Don't change the region or `STORE_NAME` once there's live data.

## 4. Email (optional)

Used for outage alerts, credential reminders and anything the app sends.

1. A **separate** app registration, `LwLAT – <App> Mailer`, with a client secret and **no** Graph API permissions.
2. A shared mailbox to send from (e.g. `<app>@lwlat.org.uk`).
3. In Exchange Online PowerShell, give the mailer app "Application Mail.Send" **scoped to that mailbox only** (RBAC for Applications). Don't grant tenant-wide `Mail.Send`.
4. Check: `Test-ServicePrincipalAuthorization` shows the mailbox InScope True and others False. It can take about 2 hours to apply.
5. Set `MAIL_CLIENT_ID`, `MAIL_CLIENT_SECRET`, `MAIL_CLIENT_SECRET_EXPIRES`, `MAIL_SENDER` and `ALERT_EMAILS`, then redeploy.

## 5. Feedback button (optional)

GitHub → Settings → Developer settings → Fine-grained tokens: resource owner the org, **only this repository**, **Issues: read and write** only, expiry up to a year. Set `GITHUB_TOKEN` (secret), `GITHUB_REPO` (`owner/name`) and `GITHUB_TOKEN_EXPIRES`, then redeploy. Without it, the button stays hidden.

## 6. Test after deploying

1. Open `https://<host>/` in a private window. You should go to Microsoft sign-in and back.
2. Sign in as someone **not** assigned: Microsoft should refuse them.
3. In a private window (not signed in), `https://<host>/api/state` returns 401 and `/admin` redirects to sign-in.
4. Sign out: you land on `/signed-out`.
5. Admin → Security review → Live status shows **Working** within 5 minutes.

## 7. Before go-live

- [ ] Remove `SEED_DEMO` and clear test data (Netlify → Blobs).
- [ ] Assignment required = Yes, MFA policy on.
- [ ] Custom domain added, with its two redirect URIs, and `APP_URL` set.
- [ ] Every secret's expiry recorded (`*_EXPIRES` and the trust's risk register).
- [ ] Deploy previews off or limited; Netlify team membership kept small.
- [ ] `npm audit` clean; git history scanned for secrets.
- [ ] Retention period agreed with the DPO; app added to the record of processing.
- [ ] Admin → Security review completed and dated (`src/admin/security.ts`).
- [ ] Pulse tile and thumbnail added.

## 8. Backups

Daily, kept 30 days in a separate Blobs store on the same site (so they don't survive the site being deleted: download an export from time to time). To restore, from a PC:

```powershell
$env:NETLIFY_SITE_ID="<site id>"; $env:NETLIFY_AUTH_TOKEN="<token>"
node scripts/backup.mts list
node scripts/backup.mts restore 2026-11-03 staff/BAB          # shows what would change
node scripts/backup.mts restore 2026-11-03 staff/BAB --yes
```

Record every restore in the change log, and delete the token afterwards.
