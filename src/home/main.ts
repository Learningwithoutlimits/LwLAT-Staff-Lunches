// Home page: the trust dashboard of staff free lunches, and (for admins and site admins) the Manage staff tab.
// Everything shown comes from /api/state, which only returns the sites this person's access allows.
// The server re-checks every change, so hiding the Manage tab is a convenience, not the protection.
import type { Day, StaffMember, StateResponse } from '../../shared/types.ts';
import { DAYS, DAY_KEYS, ukDateTime, ukWeekday } from '../../shared/constants.ts';
import { $, DEMO, esc, field } from '../lib/dom.ts';
import type { HttpError } from '../lib/http.ts';
import { initSettings } from '../lib/settings.ts';
import { initPulseLinks } from '../lib/pulse.ts';
import { maybeStartTour, startTour } from '../lib/tour.ts';
import { initFeedback, reportLink } from '../lib/feedback.ts';
import { homeTour } from './tour.ts';
import { previewImport, type ImportPreview } from './import.ts';
import { remoteApi, type HomeApi } from './api.ts';

// MODE is inlined at build time, so production builds drop the mock entirely
const api: HomeApi = import.meta.env.MODE === 'demo' ? (await import('./mock.ts')).mockApi : remoteApi;

let S: StateResponse;
const today = ukWeekday();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, bad?: boolean) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = 'toast', 3000);
}
const siteName = (code: string) => S.sites.find(s => s.code === code)?.name ?? code;
const logo = (code: string) => `/assets/sites/${code.toLowerCase()}.png`;
const readOnly = () => !!S.viewingAs;
const canManage = () => S.manage.length > 0 && !readOnly();
const dayLong = (d: Day) => DAYS.find(x => x.key === d)!.long;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const tick = (on: boolean, d: Day) => on
  ? `<span class="tick" aria-hidden="true">✓</span><span class="sr-only">${dayLong(d)}: yes</span>`
  : `<span class="sr-only">${dayLong(d)}: no</span>`;

async function load() {
  try { S = await api.state(); }
  catch (e) {
    const err = e as HttpError;
    $('#noAccess').hidden = false;
    $('#noAccessMsg').innerHTML = esc(err.message) + (err.status === 403 ? '' : ' ' + reportLink(err.message));
    return;
  }
  $('#whoName').textContent = S.user.name;
  $('#avatar').textContent = S.user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  $('#adminLink').hidden = !S.admin;
  $('#viewAsBar').hidden = !S.viewingAs;
  if (S.viewingAs) $('#viewAsName').textContent = `Viewing as ${S.viewingAs.name}`;

  const opts = (codes: string[]) => S.sites.filter(s => codes.includes(s.code)).map(s => `<option value="${esc(s.code)}">${esc(s.name)}</option>`).join('');
  $('#siteFilter').innerHTML = (S.sites.length > 1 ? '<option value="ALL">All sites</option>' : '') + opts(S.sites.map(s => s.code));
  $('#dayFilter').innerHTML = `<option value="any">Everyone with a free lunch</option>`
    + DAYS.map(d => `<option value="${d.key}">${d.long}${d.key === today ? ' (today)' : ''}</option>`).join('')
    + `<option value="all">Whole staff list</option>`;
  field('#dayFilter').value = today ?? 'any';
  $('#mSite').innerHTML = opts(S.manage);
  $('#tabs').hidden = !canManage();
  $('#dash').hidden = false;
  render();
  if (S.feedback && !DEMO) initFeedback(n => toast(`Thanks, your feedback was sent (#${n})`));
  setTimeout(() => maybeStartTour('home', S.user.email, tourSteps), 500);
}

const render = () => { renderStats(); renderCards(); renderDash(); if (canManage()) renderManage(); };

/* ---------- header figures ---------- */
function renderStats() {
  const eligible = S.staff.filter(s => s.days.length);
  const week = S.staff.reduce((n, s) => n + s.days.length, 0);
  const todayN = today ? S.staff.filter(s => s.days.includes(today)).length : null;
  $('#stats').innerHTML = `
    <div class="hstat"><div class="n">${todayN ?? '–'}</div><div class="l" style="--c:var(--lime)">${today ? `Today (${dayLong(today)})` : 'Weekend: no lunches'}</div></div>
    <div class="hstat"><div class="n">${eligible.length}</div><div class="l">Staff with free lunches</div></div>
    <div class="hstat"><div class="n">${week}</div><div class="l">Lunches a week</div></div>`;
}

/* ---------- one card per school ---------- */
function renderCards() {
  const pick = field('#siteFilter').value;
  $('#siteCards').innerHTML = S.sites.map(site => {
    const staff = S.staff.filter(s => s.site === site.code);
    const counts = DAYS.map(d => ({ ...d, n: staff.filter(s => s.days.includes(d.key)).length }));
    const max = Math.max(1, ...counts.map(c => c.n));
    const todayN = today ? counts.find(c => c.key === today)!.n : null;
    return `<button type="button" class="sitecard" data-site="${esc(site.code)}" aria-pressed="${pick === site.code}"
        aria-label="${esc(site.name)}: ${todayN === null ? '' : `${todayN} free lunches today, `}${staff.filter(s => s.days.length).length} of ${staff.length} staff have free lunches. Show this site.">
      <span class="sc-head"><img class="sitelogo" src="${logo(site.code)}" alt=""><span class="sc-name">${esc(site.name)}</span></span>
      <span class="sc-today"><b>${todayN ?? '–'}</b><span>${today ? 'today' : 'weekend'}</span></span>
      <span class="sc-week" aria-hidden="true">${counts.map(c => `<span class="sc-day${c.key === today ? ' now' : ''}">
        <span class="sc-bar"><span style="height:${Math.round(c.n / max * 100)}%"></span></span><b>${c.n}</b><small>${c.short}</small></span>`).join('')}</span>
      <span class="sc-foot">${staff.filter(s => s.days.length).length} of ${plural(staff.length, 'member', 'members')} of staff</span>
    </button>`;
  }).join('') || '<p class="empty">No sites.</p>';
}
$('#siteCards').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-site]'); if (!b) return;
  const sf = field('#siteFilter');
  sf.value = sf.value === b.dataset.site && S.sites.length > 1 ? 'ALL' : b.dataset.site!;
  render();
});

/* ---------- dashboard table ---------- */
function dashList() {
  const site = field('#siteFilter').value || 'ALL', day = field('#dayFilter').value, q = field('#q').value.trim().toLowerCase();
  return S.staff.filter(s => (site === 'ALL' || s.site === site)
    && (day === 'all' || (day === 'any' ? s.days.length > 0 : s.days.includes(day as Day)))
    && (!q || `${s.name} ${s.jobTitle}`.toLowerCase().includes(q)))
    .sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name, 'en-GB'));
}
function renderDash() {
  const list = dashList(), day = field('#dayFilter').value;
  $('#dashRows').innerHTML = list.map(s => `<tr>
    <th scope="row"><b>${esc(s.name)}</b>${s.jobTitle ? `<small>${esc(s.jobTitle)}</small>` : ''}</th>
    <td>${esc(siteName(s.site))}</td>
    ${DAYS.map(d => `<td class="day${d.key === today ? ' now' : ''}">${tick(s.days.includes(d.key), d.key)}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="7" class="empty">${S.staff.length ? 'Nobody matches.' : 'No staff lists yet.' + (canManage() ? ' Import one from Manage staff.' : '')}</td></tr>`;
  const what = day === 'all' ? 'on the staff list' : day === 'any' ? 'with a free lunch on at least one day' : `with a free lunch on ${dayLong(day as Day)}`;
  $('#dashFoot').textContent = `${plural(list.length, 'member', 'members')} of staff ${what}.`;
}
$('#q').addEventListener('input', renderDash);
$('#siteFilter').addEventListener('change', render);
$('#dayFilter').addEventListener('change', renderDash);
$('#exportCsv').addEventListener('click', () => { if (DEMO) return toast('Export works on the real site'); location.href = api.exportUrl(field('#siteFilter').value || 'ALL'); });

/* ---------- printed list for one day ---------- */
$('#printDay').addEventListener('click', () => {
  const chosen = field('#dayFilter').value;
  const day: Day = (DAY_KEYS as string[]).includes(chosen) ? chosen as Day : today ?? 'mon';
  const site = field('#siteFilter').value || 'ALL';
  const sites = S.sites.filter(s => site === 'ALL' || s.code === site);
  $('#printArea').innerHTML = sites.map(x => {
    const list = S.staff.filter(s => s.site === x.code && s.days.includes(day)).sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
    return `<section class="pr-page">
      <div class="pr-head"><div><div class="eb">Staff free lunches</div><h1>${esc(x.name)}</h1></div>
        <div class="meta"><b>${dayLong(day)}</b><br>${plural(list.length, 'free lunch', 'free lunches')}<br>Printed ${esc(ukDateTime(new Date().toISOString()))}</div></div>
      <table><thead><tr><th>Name</th><th>Job title</th><th class="pr-tick">Served</th></tr></thead>
      <tbody>${list.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.jobTitle)}</td><td class="pr-tick"></td></tr>`).join('')
        || '<tr><td colspan="3">No free lunches on this day.</td></tr>'}</tbody></table>
    </section>`;
  }).join('');
  window.print();
});

/* ---------- manage staff ---------- */
const mSite = () => field('#mSite').value;
function renderManage() {
  const q = field('#mq').value.trim().toLowerCase();
  const all = S.staff.filter(s => s.site === mSite());
  const list = all.filter(s => !q || `${s.name} ${s.jobTitle} ${s.email}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
  $('#mRows').innerHTML = list.map(s => `<tr data-id="${esc(s.id)}">
    <th scope="row"><b>${esc(s.name)}</b>${s.email ? `<small>${esc(s.email)}</small>` : ''}</th>
    <td>${esc(s.jobTitle)}</td>
    ${DAYS.map(d => `<td class="day"><button type="button" class="daybtn" data-day="${d.key}" aria-pressed="${s.days.includes(d.key)}"
        aria-label="${esc(s.name)}: free lunch on ${d.long}">${d.short}</button></td>`).join('')}
    <td class="acts"><button type="button" class="btn ghost sm" data-all aria-label="${esc(s.name)}: ${s.days.length === 5 ? 'no free lunches' : 'free lunch every day'}">${s.days.length === 5 ? 'None' : 'All week'}</button>
      <button type="button" class="btn ghost sm" data-remove aria-label="Remove ${esc(s.name)} from the list">Remove</button></td></tr>`).join('')
    || `<tr><td colspan="8" class="empty">${all.length ? 'Nobody matches.' : 'No staff on this list yet. Import the staff list, or add people one at a time.'}</td></tr>`;
  const with_ = all.filter(s => s.days.length).length;
  $('#mFoot').textContent = `${siteName(mSite())}: ${with_} of ${plural(all.length, 'member', 'members')} of staff have free lunches.`;
}
field('#mSite').addEventListener('change', renderManage);
$('#mq').addEventListener('input', renderManage);

const replace = (m: StaffMember) => {
  const i = S.staff.findIndex(x => x.id === m.id);
  if (m.removedAt) { if (i >= 0) S.staff.splice(i, 1); }
  else if (i >= 0) S.staff[i] = m; else S.staff.push(m);
};

async function saveDays(s: StaffMember, days: Day[], btns: HTMLButtonElement[]) {
  btns.forEach(b => b.disabled = true);
  try {
    const { staff } = await api.setDays(s.site, s.id, days, s.updatedAt);
    replace(staff); render();
    // keep keyboard focus on the same control after the table is redrawn
    const sel = btns.length === 1 && btns[0].dataset.day ? `[data-day="${btns[0].dataset.day}"]` : '[data-all]';
    $(`#mRows tr[data-id="${CSS.escape(s.id)}"] ${sel}`)?.focus();
    toast(`${staff.name}: ${staff.days.length ? staff.days.map(dayLong).join(', ') : 'no free lunches'}`);
  } catch (x) {
    toast((x as Error).message, true);
    btns.forEach(b => b.disabled = false);
  }
}

$('#mRows').addEventListener('click', e => {
  const t = e.target as HTMLElement, row = t.closest('tr');
  const s = S.staff.find(x => x.id === row?.dataset.id); if (!s) return;
  const dayBtn = t.closest<HTMLButtonElement>('[data-day]');
  if (dayBtn) {
    const d = dayBtn.dataset.day as Day;
    return void saveDays(s, s.days.includes(d) ? s.days.filter(x => x !== d) : DAY_KEYS.filter(k => k === d || s.days.includes(k)), [dayBtn]);
  }
  const allBtn = t.closest<HTMLButtonElement>('[data-all]');
  if (allBtn) return void saveDays(s, s.days.length === 5 ? [] : [...DAY_KEYS], [allBtn]);
  if (t.closest('[data-remove]')) openRemove(s);
});

/* add one person */
$('#aDays').innerHTML = DAYS.map(d => `<label class="check"><input type="checkbox" value="${d.key}"> ${d.long}</label>`).join('');
$('#addBtn').addEventListener('click', () => {
  (['#aName', '#aJob', '#aEmail'] as const).forEach(s => field(s).value = '');
  document.querySelectorAll<HTMLInputElement>('#aDays input').forEach(i => i.checked = false);
  $('#addTitle').textContent = siteName(mSite()); $('#aErr').textContent = '';
  $<HTMLDialogElement>('#dlgAdd').showModal(); $('#aName').focus();
});
$('#addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const days = [...document.querySelectorAll<HTMLInputElement>('#aDays input:checked')].map(i => i.value as Day);
  try {
    const { staff } = await api.add({ site: mSite(), name: field('#aName').value, jobTitle: field('#aJob').value, email: field('#aEmail').value, days });
    replace(staff); $<HTMLDialogElement>('#dlgAdd').close(); render(); toast(`Added ${staff.name}`);
  } catch (x) { $('#aErr').textContent = (x as Error).message; }
});

/* remove one person */
let removing: StaffMember | null = null;
function openRemove(s: StaffMember) {
  removing = s; $('#remTitle').textContent = s.name; field('#rReason').value = ''; $('#rErr').textContent = '';
  $<HTMLDialogElement>('#dlgRemove').showModal(); $('#rReason').focus();
}
$('#removeForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!removing) return;
  try {
    const { staff } = await api.remove(removing.site, removing.id, field('#rReason').value);
    replace(staff); $<HTMLDialogElement>('#dlgRemove').close(); render(); toast(`Removed ${staff.name}`);
  } catch (x) { $('#rErr').textContent = (x as Error).message; }
});

/* import a full staff list */
let preview: ImportPreview | null = null;
$('#importBtn').addEventListener('click', () => {
  preview = null; field('#iFile').value = ''; $('#iPreview').innerHTML = ''; $('#iErr').textContent = '';
  $('#iMissingBox').hidden = true; $<HTMLInputElement>('#iRemove').checked = false; $('#iReasonLab').hidden = true;
  $<HTMLButtonElement>('#iGo').disabled = true; $('#impTitle').textContent = siteName(mSite());
  $<HTMLDialogElement>('#dlgImport').showModal();
});
$('#iFile').addEventListener('change', async () => {
  const f = $<HTMLInputElement>('#iFile').files?.[0];
  preview = null; $('#iErr').textContent = ''; $('#iPreview').innerHTML = ''; $('#iMissingBox').hidden = true;
  $<HTMLButtonElement>('#iGo').disabled = true;
  if (!f) return;
  if (/\.xlsx?$/i.test(f.name)) { $('#iErr').textContent = 'That\'s an Excel file. In Excel, use File → Save as → CSV, then choose the CSV here.'; return; }
  if (f.size > 5_000_000) { $('#iErr').textContent = 'That file is too big for a staff list (over 5 MB).'; return; }
  try { preview = previewImport(await f.text(), S.staff.filter(s => s.site === mSite())); }
  catch (x) { $('#iErr').textContent = (x as Error).message; return; }
  const p = preview;
  $('#iPreview').innerHTML = `<div class="ipv">
    <p><b>${plural(p.rows.length, 'person', 'people')}</b> in the file: <b>${p.added.length}</b> new, <b>${p.kept}</b> already on the list.</p>
    ${p.warnings.length ? `<ul class="warn">${p.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${p.added.length ? `<details><summary>New staff (${p.added.length})</summary><ul>${p.added.slice(0, 200).map(r => `<li>${esc(r.name)}${r.jobTitle ? ` · ${esc(r.jobTitle)}` : ''}</li>`).join('')}${p.added.length > 200 ? '<li>…</li>' : ''}</ul></details>` : ''}
  </div>`;
  if (p.missing.length) {
    $('#iMissingBox').hidden = false;
    $('#iRemoveLbl').innerHTML = `Remove ${plural(p.missing.length, 'person', 'people')} on the list who ${p.missing.length === 1 ? "isn't" : "aren't"} in this file: `
      + esc(p.missing.slice(0, 8).map(s => s.name).join(', ')) + (p.missing.length > 8 ? '…' : '');
  }
  $<HTMLButtonElement>('#iGo').disabled = false;
});
$('#iRemove').addEventListener('change', () => { $('#iReasonLab').hidden = !$<HTMLInputElement>('#iRemove').checked; });
$('#importForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!preview) return;
  const go = $<HTMLButtonElement>('#iGo'); go.disabled = true;
  try {
    const removeMissing = $<HTMLInputElement>('#iRemove').checked;
    const r = await api.importList({ site: mSite(), rows: preview.rows, removeMissing, reason: removeMissing ? field('#iReason').value : undefined });
    S.staff = S.staff.filter(s => s.site !== r.site).concat(r.staff);
    $<HTMLDialogElement>('#dlgImport').close(); render();
    toast(`Imported: ${r.added} added, ${r.updated} updated, ${r.removed} removed`);
  } catch (x) { $('#iErr').textContent = (x as Error).message; go.disabled = false; }
});

/* ---------- tabs ---------- */
function showTab(manage: boolean) {
  $('#tabDash').setAttribute('aria-selected', String(!manage)); $('#tabManage').setAttribute('aria-selected', String(manage));
  $('#tabDash').tabIndex = manage ? -1 : 0; $('#tabManage').tabIndex = manage ? 0 : -1;
  $('#dash').hidden = manage; $('#manage').hidden = !manage;
  if (manage) renderManage();
}
$('#tabDash').addEventListener('click', () => showTab(false));
$('#tabManage').addEventListener('click', () => showTab(true));
$('#tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const manage = $('#tabDash').getAttribute('aria-selected') === 'true';
  showTab(manage); $(manage ? '#tabManage' : '#tabDash').focus();
});

$('#stopViewAs').addEventListener('click', async () => { await api.stopViewAs(); location.href = '/admin'; });
document.querySelectorAll<HTMLElement>('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog')!.close()));

$('#demoBanner').hidden = !DEMO;
const tourSteps = () => homeTour(S.user.name.split(' ')[0] || '', S.admin, canManage(), () => showTab(true), () => showTab(false));
initSettings({ tour: () => startTour('home', S.user.email, tourSteps()) });
initPulseLinks();
load();
