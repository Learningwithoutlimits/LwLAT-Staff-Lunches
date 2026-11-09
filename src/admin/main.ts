// Admin portal: people and access rules, sites, sign-ins, change log and the security review.
// The server enforces every rule; this page only hides what a person can't use.
import type { AccessConfig, AccessRole, AdminConfigResponse, GroupRule, Role, UserRule } from '../../shared/types.ts';
import { ukDateTime as fmt } from '../../shared/constants.ts';
import { $, DEMO, esc, field, target } from '../lib/dom.ts';
import { initSettings } from '../lib/settings.ts';
import { initPulseLinks } from '../lib/pulse.ts';
import { maybeStartTour, startTour } from '../lib/tour.ts';
import { adminTour } from './tour.ts';
import { renderSecurityReview } from './security.ts';
import type { HttpError } from '../lib/http.ts';
import { remoteApi, type AdminApi } from './api.ts';

// MODE is inlined at build time, so production builds drop the mock entirely
const api: AdminApi = import.meta.env.MODE === 'demo' ? (await import('./mock.ts')).mockApi : remoteApi;

/* ---------- helpers + state ---------- */
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, bad?: boolean){ const t=$('#toast'); t.textContent=msg; t.className='toast show'+(bad?' bad':''); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.className='toast',3000); }
const ROLE_LABEL: Record<AccessRole, string> = { admin:'Admin', central:'Central', siteadmin:'Site admin', site:'Site', blocked:'Blocked', none:'No access' };
const isFull = () => A.data.full;
const roleChoices = (): Role[] => isFull() ? ['site','central','siteadmin','admin','blocked'] : ['site'];
const hasSites = (r: Role) => r==='site' || r==='siteadmin';
const dialog = (sel: string) => $<HTMLDialogElement>(sel);

// `data` is what the server has; `draft` is the access config being edited (saved with the save bar)
const A = { data: null as unknown as AdminConfigResponse, draft: null as unknown as AccessConfig };
const dirty = () => JSON.stringify(A.draft) !== JSON.stringify(A.data.config);
const siteChips = (selected: string[], enabled: boolean, attr: string) => A.draft.sites.map(s =>
  `<button type="button" class="sc" ${attr} data-site="${s.code}" aria-pressed="${selected.includes(s.code)}" ${enabled?'':'disabled'} title="${esc(s.name)}">${s.code}</button>`).join('');
const toggle = (list: string[], c: string) => list.includes(c) ? list.filter(x=>x!==c) : [...list, c];
const domainList = (v: string) => v.split(/[\s,;]+/).map(x=>x.trim().toLowerCase()).filter(Boolean);

async function load(){
  try {
    A.data = await api.config();
    A.draft = structuredClone(A.data.config);
    $('#whoName').textContent = A.data.me.name;
    applyScope();
    renderAll();
    renderSecurityReview($('#securityReview'), A.data.health);
    setTimeout(() => maybeStartTour('admin', A.data.me.email, tourSteps), 500);
  } catch(e){
    const err = e as HttpError;
    document.querySelectorAll<HTMLElement>('section,.tabs').forEach(x=>x.hidden=true);
    $('#blocked').hidden=false; $('#blockedMsg').textContent = err.status===403 ? 'Only admins can open the admin portal.' : err.message;
    if (err.status===403) api.viewAsStatus().then(({ viewingAs: v }) => {
      if (!v) return;
      $('#blockedMsg').textContent = `You're viewing as ${v.name}, who isn't an admin, so the portal is hidden.`;
      const b = Object.assign(document.createElement('button'), { className:'btn ghost', textContent:'Stop viewing', type:'button' });
      b.style.marginLeft='8px'; b.addEventListener('click', async()=>{ await api.stopViewAs(); location.reload(); });
      $('#blocked a').after(b);
    }).catch(()=>{});
  }
}

/* ---------- View as ---------- */
async function viewAs(email: string){
  if (dirty()){
    if (!confirm('You have unsaved access changes, and "View as" only sees saved settings.\n\nSave your changes now and continue?')) return;
    if (!await saveDraft()) return;
  }
  try { await api.viewAs(email); location.href = '/'; }
  catch(e){ toast((e as Error).message, true); }
}
function fillViewAsList(){
  const emails = new Set([...Object.keys(A.draft.users), ...Object.keys(A.data.seen)]);
  emails.delete(A.data.me.email);
  $('#vaList').innerHTML = [...emails].sort().map(e=>`<option value="${esc(e)}">${esc(A.data.seen[e]?.name || '')}</option>`).join('');
}
$('#openViewAs').addEventListener('click', () => { field('#vaEmail').value=''; dialog('#dlgViewAs').showModal(); $('#vaEmail').focus(); });
$('#viewAsForm').addEventListener('submit', e => { e.preventDefault(); dialog('#dlgViewAs').close(); viewAs(field('#vaEmail').value.trim()); });
function applyScope(){
  const full = isFull(), mine = A.data.config.sites.map(s=>s.code).join(', ');
  document.querySelector<HTMLElement>('[data-tab="sites"]')!.hidden = !full;
  ['#groupsCard','#centralCard','#openViewAs','#envAdmins','#accessHelp'].forEach(s=>$(s).hidden=!full);
  $('#scopeNote').hidden = full;
  $('#scopeNote').textContent = `You're a site admin for ${mine}. You can add and change Site access for those sites. Anything else needs a full admin.`;
  $('.htitle .sub').textContent = full ? 'Admin portal' : `Site admin · ${mine}`;
  $('#npRole').innerHTML = roleChoices().map(r=>`<option value="${r}">${ROLE_LABEL[r]}</option>`).join('');
}
function renderAll(){ renderPeople(); renderGroups(); renderSites(); renderSeen(); fillViewAsList(); field('#centralDomains').value=A.draft.centralDomains.join(', '); updateSavebar(); }
function updateSavebar(){ $('#savebar').hidden = !dirty(); }

/* ---------- People ---------- */
let npSites: string[] = [];
const expanded = new Set<string>();
const accessText = (u: UserRule) => hasSites(u.role) ? (u.sites.join(', ') || 'no sites') : u.role==='blocked' ? 'no access' : 'all sites';
const P = { q: '', role: 'all' as Role | 'all' };
function renderPeople(){
  $('#envAdmins').innerHTML = 'Built-in admins' + (A.data.envAdmins.map(e=>`<span class="chip">${esc(e)}</span>`).join('') || ' <i>none set</i>');
  const all = Object.entries(A.draft.users).sort(([a],[b])=>a.localeCompare(b));
  const roles = roleChoices().filter(r => all.some(([,u])=>u.role===r));
  if (P.role!=='all' && !roles.includes(P.role)) P.role='all';
  $('#roleChips').innerHTML = roles.length < 2 ? '' : [['all','Everyone',all.length] as const, ...roles.map(r=>[r, ROLE_LABEL[r], all.filter(([,u])=>u.role===r).length] as const)]
    .map(([v,l,n])=>`<button type="button" class="fchip" data-role="${v}" aria-pressed="${P.role===v}">${l}<span class="ct">${n}</span></button>`).join('');
  const q = P.q.toLowerCase();
  const rows = all.filter(([email,u]) => (P.role==='all' || u.role===P.role) && (!q || `${email} ${u.note||''} ${A.data.seen[email]?.name||''}`.toLowerCase().includes(q)));
  $('#peopleBody').innerHTML = rows.map(([email,u]) => { const open=expanded.has(email), s=A.data.seen[email], em=esc(email);
    return `<tr class="prow" data-email="${em}" aria-expanded="${open}">
    <td><button type="button" class="icon-btn caret" data-f="toggle" aria-expanded="${open}" aria-label="${open?'Hide':'Edit'} ${em}">▶</button></td>
    <td>${s && s.name!==email ? `<b>${esc(s.name)}</b><small class="who-sub">${em}</small>` : `<b>${em}</b>`}<small class="who-sub">${[u.automatic?'Automatic access':'', s?`Last in ${fmt(s.at)}`:''].filter(Boolean).join(' · ')}</small></td>
    <td><span class="pill ${u.role}">${ROLE_LABEL[u.role]}</span> <span class="dim">${esc(accessText(u))}</span></td>
    <td class="dim" data-note>${esc(u.note||'')}</td>
    <td class="rowacts">${isFull()?`<button type="button" class="icon-btn" data-f="viewas" title="View the app as ${em}" aria-label="View the app as ${em}">👁</button>`:''}<button type="button" class="icon-btn del" data-f="del" title="Remove" aria-label="Remove ${em}">✕</button></td></tr>
    <tr class="pdetail" data-email="${em}" ${open?'':'hidden'}><td></td><td colspan="4"><div class="row">
      <label class="lab">Role<select class="in" data-f="role">${roleChoices().map(r=>`<option value="${r}" ${u.role===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}</select></label>
      <div class="lab">Sites<div class="sitechips">${siteChips(u.sites||[], hasSites(u.role), 'data-f="site"')}</div></div>
      <label class="lab" style="flex:1 1 200px">Note<input class="in" data-f="note" value="${esc(u.note||'')}" maxlength="80"></label>
    </div></td></tr>`; }).join('') || `<tr><td colspan="5" class="empty">${all.length ? 'No one matches.' : 'No one added yet.'}</td></tr>`;
  $('#npSites').innerHTML = siteChips(npSites, hasSites(field('#npRole').value as Role), 'data-np');
  // protected admins can't be edited here
  document.querySelectorAll<HTMLTableRowElement>('#peopleBody tr').forEach(row => {
    if (!A.data.envAdmins.includes(row.dataset.email ?? '')) return;
    row.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('[data-f]').forEach(control => {
      if (control.dataset.f === 'toggle' || control.dataset.f === 'viewas') return;
      control.disabled = true; control.title = 'Protected overall admin';
    });
  });
}
$('#peopleBody').addEventListener('input', e => {
  const t=target(e) as HTMLInputElement, tr=t.closest('tr'); const u=A.draft.users[tr?.dataset.email ?? '']; if(!u) return;
  delete u.automatic;
  if (t.dataset.f==='role'){ u.role=t.value as Role; if(!hasSites(u.role)) u.sites=[]; renderPeople(); }
  if (t.dataset.f==='note'){ u.note=t.value; const n=tr!.previousElementSibling?.querySelector('[data-note]'); if(n) n.textContent=t.value; }
  updateSavebar();
});
$('#peopleBody').addEventListener('click', e => {
  const t=target(e), email=t.closest('tr')?.dataset.email ?? ''; const u=A.draft.users[email]; if(!u) return;
  const f=t.closest<HTMLElement>('[data-f]')?.dataset.f;
  if (f==='viewas'){ viewAs(email); return; }
  if (f==='del'){ delete A.draft.users[email]; expanded.delete(email); renderPeople(); updateSavebar(); return; }
  if (f==='site'){ delete u.automatic; u.sites = toggle(u.sites, t.dataset.site!); renderPeople(); updateSavebar(); return; }
  if (t.closest('.prow')){ if (expanded.has(email)) expanded.delete(email); else expanded.add(email); renderPeople(); }
});
$('#pq').addEventListener('input', ()=>{ P.q=field('#pq').value.trim(); renderPeople(); });
$('#roleChips').addEventListener('click', e=>{ const r=target(e).closest<HTMLElement>('[data-role]')?.dataset.role; if(!r) return; P.role=r as Role | 'all'; renderPeople(); });
function showAddPerson(open: boolean, email = '', note = ''){
  $('#addPerson').hidden = !open; $('#openAdd').setAttribute('aria-expanded', String(open));
  if (!open) return;
  if (email){ field('#npEmail').value=email; field('#npNote').value=note; }
  $('#addPerson').scrollIntoView({behavior:'smooth',block:'nearest'}); (email ? $('#npRole') : $('#npEmail')).focus();
}
$('#openAdd').addEventListener('click', ()=>showAddPerson($('#addPerson').hidden===true));
$('#cancelAdd').addEventListener('click', ()=>{ field('#npEmail').value=''; field('#npNote').value=''; showAddPerson(false); });
$('#npRole').addEventListener('change', ()=>{ if(!hasSites(field('#npRole').value as Role)) npSites=[]; renderPeople(); });
$('#npSites').addEventListener('click', e => { const c=target(e).dataset.site; if(!c) return; npSites = toggle(npSites, c); renderPeople(); });
$('#addPerson').addEventListener('submit', e => {
  e.preventDefault();
  const email=field('#npEmail').value.trim().toLowerCase(), role=field('#npRole').value as Role;
  if (A.draft.users[email]) return toast(`${email} is already listed`, true);
  if (hasSites(role) && !npSites.length) return toast('Pick at least one site', true);
  A.draft.users[email] = { role, sites: hasSites(role)?npSites:[], note:field('#npNote').value.trim() };
  field('#npEmail').value=''; field('#npNote').value=''; npSites=[];
  P.q=''; field('#pq').value=''; P.role='all'; showAddPerson(false); renderPeople(); renderSeen(); updateSavebar();
  toast(`${email} added. Remember to save.`);
});

/* ---------- Groups ---------- */
function renderGroups(){
  $('#groupsBody').innerHTML = A.draft.groupRules.map((g,i)=>`<tr data-i="${i}">
    <td><input class="in mono" data-f="groupId" value="${esc(g.groupId)}" placeholder="00000000-0000-0000-0000-000000000000" aria-label="Group object ID"></td>
    <td><input class="in" data-f="label" value="${esc(g.label)}" placeholder="e.g. Babington Reception" aria-label="Label"></td>
    <td><select class="in" data-f="role" aria-label="Role">${(['site','siteadmin','central','admin'] as const).map(r=>`<option value="${r}" ${g.role===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}</select></td>
    <td><div class="sitechips">${siteChips(g.sites, hasSites(g.role), 'data-f="site"')}</div></td>
    <td><button class="icon-btn del" data-f="del" title="Remove" aria-label="Remove">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No group rules.</td></tr>';
}
const groupRow = (e: Event) => { const t=target(e), i=Number(t.closest('tr')?.dataset.i); return { t, i, g: A.draft.groupRules[i] as GroupRule | undefined }; };
$('#groupsBody').addEventListener('input', e => { const { t, g } = groupRow(e); if(!g) return; const f=t.dataset.f, v=(t as HTMLInputElement).value;
  if (f==='groupId'||f==='label') g[f]=v.trim(); if (f==='role'){ g.role=v as GroupRule['role']; if(!hasSites(g.role)) g.sites=[]; renderGroups(); } updateSavebar(); });
$('#groupsBody').addEventListener('click', e => { const { t, i, g } = groupRow(e); if(!g) return;
  if (t.dataset.f==='site'){ g.sites=toggle(g.sites, t.dataset.site!); renderGroups(); updateSavebar(); }
  if (t.dataset.f==='del'){ A.draft.groupRules.splice(i,1); renderGroups(); updateSavebar(); } });
$('#addGroup').addEventListener('click', ()=>{ A.draft.groupRules.push({groupId:'',label:'',role:'site',sites:[]}); renderGroups(); updateSavebar(); });
$('#centralDomains').addEventListener('input', ()=>{ A.draft.centralDomains = domainList(field('#centralDomains').value); updateSavebar(); });

/* ---------- Sites ---------- */
function renderSites(){
  const saved = new Set(A.data.config.sites.map(s=>s.code));
  $('#sitesBody').innerHTML = A.draft.sites.map((s,i)=>`<tr data-i="${i}">
    <td>${saved.has(s.code)?`<b class="mono">${esc(s.code)}</b>`:`<input class="in mono" data-f="code" value="${esc(s.code)}" maxlength="6" style="width:90px;text-transform:uppercase" placeholder="ABC" aria-label="Code">`}</td>
    <td><input class="in" data-f="name" value="${esc(s.name)}" maxlength="80" aria-label="Name"></td>
    <td><input class="in mono" data-f="domains" value="${esc(s.domains.join(', '))}" placeholder="none" aria-label="Email domains"></td>
    <td>${saved.has(s.code)?'':'<button class="icon-btn del" data-f="del" title="Remove" aria-label="Remove">✕</button>'}</td></tr>`).join('');
}
$('#sitesBody').addEventListener('input', e => { const t=target(e) as HTMLInputElement; const s=A.draft.sites[Number(t.closest('tr')?.dataset.i)]; if(!s) return; const f=t.dataset.f;
  if (f==='domains') s.domains = domainList(t.value);
  else if (f==='code') s.code = t.value.toUpperCase().replace(/[^A-Z]/g,'');
  else if (f==='name') s.name = t.value;
  updateSavebar(); });
$('#sitesBody').addEventListener('click', e => { const t=target(e); if(t.dataset.f!=='del') return; A.draft.sites.splice(Number(t.closest('tr')!.dataset.i),1); renderSites(); updateSavebar(); });
$('#addSite').addEventListener('click', ()=>{ A.draft.sites.push({code:'',name:'',domains:[]}); renderSites(); updateSavebar(); });

/* ---------- Save bar ---------- */
$('#discard').addEventListener('click', ()=>{ A.draft=structuredClone(A.data.config); renderAll(); });
async function saveDraft(){
  const b=$<HTMLButtonElement>('#save'); b.disabled=true;
  try { const { config } = await (isFull() ? api.saveAccess(A.draft) : api.savePeople(A.draft.users)); A.data.config=config; A.draft=structuredClone(config); renderAll(); toast('Access saved'); return true; }
  catch(e){ toast((e as Error).message, true); return false; }
  finally { b.disabled=false; }
}
$('#save').addEventListener('click', saveDraft);
window.addEventListener('beforeunload', e=>{ if (A.data && dirty()){ e.preventDefault(); e.returnValue=''; } });

/* ---------- Sign-ins ---------- */
function renderSeen(){
  const rows = Object.entries(A.data.seen).map(([email, s]) => ({ email, s, a: A.data.seenAccess[email] }))
    .sort((x, y) => Number(!!x.a?.sites.length || !!x.a?.admin) - Number(!!y.a?.sites.length || !!y.a?.admin) || y.s.at.localeCompare(x.s.at));
  const turnedAway = rows.filter(r => !r.a?.admin && !r.a?.sites.length && !A.draft.users[r.email]).length;
  $('#seenCount').hidden = !turnedAway; $('#seenCount').textContent = String(turnedAway);
  $('#seenBody').innerHTML = rows.map(({ email, s, a }) => { const none = !a?.admin && !a?.sites.length;
    return `<tr class="${none?'away':''}"><td>${esc(s.name)}</td><td class="mono">${esc(email)}</td><td>${fmt(s.at)}</td>
    <td><span class="pill ${a?.role ?? 'none'}">${ROLE_LABEL[a?.role ?? 'none']}</span></td>
    <td class="rowacts">${none && !A.draft.users[email] ? `<button type="button" class="btn ghost sm" data-give="${esc(email)}">Give access</button>` : ''}
      ${isFull() && email!==A.data.me.email ? `<button type="button" class="icon-btn" data-viewas="${esc(email)}" title="View as" aria-label="View the app as ${esc(email)}">👁</button>` : ''}</td></tr>`; }).join('')
    || '<tr><td colspan="5" class="empty">No sign-ins yet.</td></tr>';
}
$('#seenBody').addEventListener('click', e=>{ const va=target(e).closest<HTMLElement>('[data-viewas]')?.dataset.viewas; if(va) return void viewAs(va);
  const em=target(e).dataset.give; if(!em) return;
  showTab('people'); showAddPerson(true, em, A.data.seen[em]?.name||''); });

/* ---------- Change log ---------- */
async function loadAudit(){
  $('#auditBody').innerHTML='<tr><td colspan="3" class="empty">Loading…</td></tr>';
  try { const { rows } = await api.audit();
    $('#auditBody').innerHTML = rows.map(r=>`<tr><td style="white-space:nowrap">${fmt(r.at)}</td><td>${esc(r.by?.name)}</td><td>${esc(r.detail)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No changes yet.</td></tr>'; }
  catch(e){ $('#auditBody').innerHTML=`<tr><td colspan="3" class="empty">${esc((e as Error).message)}</td></tr>`; }
}

/* ---------- Tabs + boot ---------- */
function showTab(name: string){
  document.querySelectorAll<HTMLElement>('.tab').forEach(t=>t.setAttribute('aria-selected', String(t.dataset.tab===name)));
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach(p=>p.hidden = p.dataset.panel!==name);
  if (name==='audit') loadAudit();
}
document.querySelectorAll<HTMLElement>('.tab').forEach(t=>t.addEventListener('click',()=>showTab(t.dataset.tab!)));
document.querySelectorAll<HTMLElement>('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog')!.close()));
$('#previewBanner').hidden = !DEMO;
const tourSteps = () => adminTour(A.data.me.name.split(' ')[0] || '', isFull(), showTab);
initSettings({ tour: () => startTour('admin', A.data.me.email, tourSteps()) });
initPulseLinks();
load();
