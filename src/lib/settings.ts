// Appearance settings + the settings drawer, in line with the IT staff rota: mode, theme, colour
// intensity, text size, zoom, density, high contrast and reduce motion. Saved per browser.
//
// The generated colours for the current choices are also cached in localStorage, so
// /assets/theme-boot.js can put them on <html> before the page first paints (no flash of the
// wrong theme). This module then takes over: it re-applies, follows the system dark setting,
// and builds the drawer behind any [data-settings] button.
import { buildPalette, DEFAULT_THEME, THEMES, type Mode } from './palette.ts';

interface Settings {
  mode: Mode | 'system';
  theme: string;
  tint: number;          // colour intensity: 0.5 subtle | 1 balanced | 1.8 vivid
  textSize: number;      // 0.9 | 1 | 1.125 | 1.25
  zoom: number;          // see ZOOM_STEPS
  density: 'comfortable' | 'compact';
  contrast: boolean;
  reduceMotion: boolean | null;   // null = follow the system setting
}
const DEFAULTS: Settings = { mode: 'system', theme: DEFAULT_THEME, tint: 1, textSize: 1, zoom: 1, density: 'comfortable', contrast: false, reduceMotion: null };
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
const STORE_KEY = 'lwlat-settings', CACHE_KEY = 'lwlat-settings-cache';

function load(): Settings {
  let s: Partial<Settings> = {};
  try { s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { s = {}; }
  const out = { ...DEFAULTS, ...s };
  if (!THEMES[out.theme]) out.theme = DEFAULT_THEME;
  return out;
}
let state = load();

const mqDark = matchMedia('(prefers-color-scheme: dark)');
const mqMotion = matchMedia('(prefers-reduced-motion: reduce)');
const effectiveMode = (): Mode => state.mode === 'system' ? (mqDark.matches ? 'dark' : 'light') : state.mode;
const effectiveMotion = () => state.reduceMotion ?? mqMotion.matches;
const palette = (mode: Mode) => buildPalette(THEMES[state.theme], mode, { contrast: state.contrast, tint: state.tint });

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    // What theme-boot.js needs to paint the first frame correctly, including both modes for "System"
    const cls = [state.contrast && 'hc', state.density === 'compact' && 'compact', effectiveMotion() && 'reduce-motion'].filter(Boolean);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ mode: state.mode, light: palette('light'), dark: palette('dark'), cls, ts: state.textSize, zoom: state.zoom }));
  } catch { /* private window or storage blocked: settings just won't be remembered */ }
}

function apply() {
  const html = document.documentElement, mode = effectiveMode();
  html.classList.toggle('dark', mode === 'dark');
  html.classList.toggle('light', mode === 'light');
  html.classList.toggle('hc', state.contrast);
  html.classList.toggle('compact', state.density === 'compact');
  html.classList.toggle('reduce-motion', effectiveMotion());
  const p = palette(mode);
  for (const [k, v] of Object.entries(p)) html.style.setProperty(`--${k}`, v);
  html.style.setProperty('--ts', String(state.textSize));
  html.style.setProperty('--ui-zoom', String(state.zoom));
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) { meta = Object.assign(document.createElement('meta'), { name: 'theme-color' }); document.head.append(meta); }
  meta.content = p['hdr-2'];
  syncUI();
}

// Fade colours across a theme/mode change instead of snapping
let fadeTimer: ReturnType<typeof setTimeout> | undefined;
function withTransition(fn: () => void) {
  const html = document.documentElement;
  if (!effectiveMotion()) html.classList.add('theme-fade');
  fn();
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => html.classList.remove('theme-fade'), 300);
}
function set<K extends keyof Settings>(key: K, value: Settings[K]) {
  state = { ...state, [key]: value };
  save();
  ['mode', 'theme', 'tint', 'contrast'].includes(key) ? withTransition(apply) : apply();
}
function reset() { state = { ...DEFAULTS }; save(); withTransition(apply); }

mqDark.addEventListener('change', () => { if (state.mode === 'system') withTransition(apply); });
mqMotion.addEventListener('change', () => { if (state.reduceMotion === null) { save(); apply(); } });

/* ---------- Drawer ---------- */
const ICONS = {
  light: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  system: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
};
const seg = (key: keyof Settings, label: string, opts: [string, string][], cls = '') =>
  `<div class="sp-field"><div class="sp-label" id="sp-${key}">${label}</div>
   <div class="sp-seg ${cls}" role="radiogroup" aria-labelledby="sp-${key}" data-setting="${key}">${opts.map(([v, html]) => `<button type="button" role="radio" data-value="${v}">${html}</button>`).join('')}</div></div>`;
const toggleRow = (key: keyof Settings, title: string, hint: string) =>
  `<label class="sp-switch"><span class="sp-switch-text"><strong>${title}</strong><small>${hint}</small></span>
   <input type="checkbox" role="switch" data-setting="${key}"><span class="sp-switch-ui" aria-hidden="true"></span></label>`;

const DRAWER = `
<div class="settings-overlay" id="settings-overlay"></div>
<aside class="settings-panel" id="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
  <div class="sp-head"><h2 id="settings-title">Settings</h2><button class="sp-close" type="button" aria-label="Close settings">${ICONS.close}</button></div>
  <div class="sp-body">
    <section class="sp-section"><h3 class="sp-section-title">Appearance</h3>
      ${seg('mode', 'Mode', [['light', `${ICONS.light}Light`], ['dark', `${ICONS.dark}Dark`], ['system', `${ICONS.system}System`]])}
      <div class="sp-field"><div class="sp-label" id="sp-theme-label">Theme</div><div class="sp-themes" id="sp-themes" role="radiogroup" aria-labelledby="sp-theme-label"></div></div>
      ${seg('tint', 'Colour intensity', [['0.5', 'Subtle'], ['1', 'Balanced'], ['1.8', 'Vivid']])}
    </section>
    <section class="sp-section"><h3 class="sp-section-title">Text &amp; layout</h3>
      ${seg('textSize', 'Text size', [['0.9', '<span style="font-size:12px" aria-label="Small">Aa</span>'], ['1', '<span style="font-size:14px" aria-label="Default">Aa</span>'], ['1.125', '<span style="font-size:16px" aria-label="Large">Aa</span>'], ['1.25', '<span style="font-size:18px" aria-label="Extra large">Aa</span>']], 'sp-seg-text')}
      <div class="sp-field sp-field-inline"><div><div class="sp-label" id="sp-zoom-label">Zoom</div><div class="sp-hint">Scales the whole page</div></div>
        <div class="sp-stepper" role="group" aria-labelledby="sp-zoom-label"><button type="button" id="sp-zoom-out" data-zoom="-1" aria-label="Zoom out">−</button><output id="sp-zoom-val" aria-live="polite">100%</output><button type="button" id="sp-zoom-in" data-zoom="1" aria-label="Zoom in">+</button></div></div>
      ${seg('density', 'Density', [['comfortable', 'Comfortable'], ['compact', 'Compact']])}
    </section>
    <section class="sp-section"><h3 class="sp-section-title">Accessibility</h3>
      ${toggleRow('contrast', 'High contrast', 'Stronger text, borders and focus outlines')}
      ${toggleRow('reduceMotion', 'Reduce motion', 'Turns off animations and transitions')}
    </section>
  </div>
  <div class="sp-foot"><span>Saved on this device</span><button type="button" class="sp-reset">Reset to defaults</button></div>
</aside>`;

let panel: HTMLElement | null = null, lastFocus: Element | null = null;

function renderThemes() {
  const wrap = panel?.querySelector('#sp-themes');
  if (!wrap) return;
  const mode = effectiveMode();
  wrap.innerHTML = Object.entries(THEMES).map(([id, th]) => {
    const p = buildPalette(th, mode, { contrast: state.contrast, tint: state.tint });
    const on = id === state.theme;
    return `<button type="button" class="sp-theme${on ? ' active' : ''}" role="radio" data-theme="${id}" aria-checked="${on}">
      <span class="sp-theme-preview" style="background:${p.canvas}"><span class="sp-theme-card" style="background:${p.bg};border-color:${p.border}">
        <span class="sp-theme-bar" style="background:linear-gradient(90deg,${p['hdr-1']},${p['hdr-3']})"></span>
        <span class="sp-theme-line" style="background:${p.text3}"></span>
        <span class="sp-theme-btn" style="background:${p.accent}"></span></span></span>
      <span class="sp-theme-name">${th.name}</span></button>`;
  }).join('');
}

function syncUI() {
  if (!panel) return;
  panel.querySelectorAll<HTMLElement>('[data-setting]').forEach(group => {
    const key = group.dataset.setting as keyof Settings;
    if (group instanceof HTMLInputElement) { group.checked = key === 'reduceMotion' ? effectiveMotion() : !!state[key]; return; }
    group.querySelectorAll<HTMLElement>('[data-value]').forEach(b => {
      const on = String(state[key]) === b.dataset.value;
      b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on));
    });
  });
  renderThemes();
  const zi = ZOOM_STEPS.indexOf(state.zoom);
  panel.querySelector('#sp-zoom-val')!.textContent = `${Math.round(state.zoom * 100)}%`;
  panel.querySelector<HTMLButtonElement>('#sp-zoom-out')!.disabled = zi <= 0;
  panel.querySelector<HTMLButtonElement>('#sp-zoom-in')!.disabled = zi >= ZOOM_STEPS.length - 1;
}

const buttons = () => document.querySelectorAll<HTMLElement>('[data-settings]');
function open() {
  if (!panel) return;
  lastFocus = document.activeElement;
  panel.classList.add('open');
  document.getElementById('settings-overlay')!.classList.add('open');
  buttons().forEach(b => b.setAttribute('aria-expanded', 'true'));
  document.documentElement.classList.add('settings-open');
  setTimeout(() => panel!.querySelector<HTMLElement>('.sp-close')!.focus(), 50);
}
function close() {
  if (!panel?.classList.contains('open')) return;
  panel.classList.remove('open');
  document.getElementById('settings-overlay')!.classList.remove('open');
  buttons().forEach(b => b.setAttribute('aria-expanded', 'false'));
  document.documentElement.classList.remove('settings-open');
  if (lastFocus instanceof HTMLElement) lastFocus.focus();
}

/** Add the drawer to the page and wire up every [data-settings] button. tour: replays the page's guided tour (Help section). */
export function initSettings(opts: { tour?: () => void } = {}) {
  document.body.insertAdjacentHTML('beforeend', DRAWER);
  panel = document.getElementById('settings-panel')!;
  if (opts.tour) {
    panel.querySelector('.sp-body')!.insertAdjacentHTML('beforeend', `<section class="sp-section"><h3 class="sp-section-title">Help</h3>
      <button type="button" class="sp-link" data-tour><span class="sp-switch-text"><strong>Show the tour again</strong><small>A quick walk through this page</small></span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg></button></section>`);
    panel.querySelector('[data-tour]')!.addEventListener('click', () => { close(); setTimeout(opts.tour!, 320); });
  }
  buttons().forEach(b => {
    b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-controls', 'settings-panel'); b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', open);
  });
  document.getElementById('settings-overlay')!.addEventListener('click', close);
  panel.querySelector('.sp-close')!.addEventListener('click', close);
  panel.querySelector('.sp-reset')!.addEventListener('click', reset);

  panel.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const theme = t.closest<HTMLElement>('.sp-theme');
    if (theme) { set('theme', theme.dataset.theme!); return; }
    const opt = t.closest<HTMLElement>('[data-value]'), group = opt?.closest<HTMLElement>('[data-setting]');
    if (opt && group) {
      const raw = opt.dataset.value!, key = group.dataset.setting as keyof Settings;
      set(key, (isNaN(parseFloat(raw)) ? raw : parseFloat(raw)) as never);
      return;
    }
    const zoom = t.closest<HTMLElement>('[data-zoom]');
    if (zoom) {
      const i = Math.max(0, Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(state.zoom) + Number(zoom.dataset.zoom)));
      set('zoom', ZOOM_STEPS[i]);
    }
  });
  panel.addEventListener('change', e => {
    const t = e.target as HTMLInputElement;
    if (t.type === 'checkbox' && t.dataset.setting) set(t.dataset.setting as 'contrast' | 'reduceMotion', t.checked);
  });
  // Arrow keys move between options in a segmented group or the theme grid
  panel.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const group = (e.target as HTMLElement).closest('[role="radiogroup"]');
    const items = group ? [...group.querySelectorAll<HTMLElement>('[role="radio"]')] : [];
    const i = items.indexOf(e.target as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const next = items[(i + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) + items.length) % items.length];
    next.click();
    // the theme grid re-renders on click, so focus the new button by its value
    const sel = next.dataset.theme ? `[data-theme="${next.dataset.theme}"]` : null;
    (sel ? panel!.querySelector<HTMLElement>(sel) : next)?.focus();
  });
  document.addEventListener('keydown', e => {
    if (!panel!.classList.contains('open')) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    // Keep keyboard focus inside the open drawer
    const f = [...panel!.querySelectorAll<HTMLElement>('button:not(:disabled), input')];
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  syncUI();
}

save();   // refresh the boot cache (e.g. after the palette code changes in a new release)
apply();
