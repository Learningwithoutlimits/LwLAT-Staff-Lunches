// First-time guided tour: spotlights one part of the page at a time with a short explanation.
// The spotlighted element stays usable (you can try it while the tour is open). Shown once per person
// per browser, so each receptionist on a shared PC gets it; replay it from Settings → Help.
// Steps whose target isn't on the page (or is hidden) are skipped, so one list suits every role.

export interface TourStep {
  /** CSS selector of the thing to spotlight; leave out for a centred message */
  target?: string;
  title: string;
  /** HTML (trusted, written in the app) */
  body: string;
  /** Run before the step shows, e.g. switch to the tab it talks about */
  before?: () => void;
}

const doneKey = (id: string, who: string) => `fr.tour.${id}.${who.toLowerCase()}`;
const seen = (id: string, who: string) => { try { return localStorage.getItem(doneKey(id, who)) === '1'; } catch { return true; } };
const markSeen = (id: string, who: string) => { try { localStorage.setItem(doneKey(id, who), '1'); } catch { /* storage blocked */ } };

let active: { close: () => void } | null = null;

/** Start the tour if this person hasn't seen it on this browser yet */
export function maybeStartTour(id: string, who: string, steps: () => TourStep[]) {
  if (!seen(id, who) && !document.querySelector('dialog[open]')) startTour(id, who, steps());
}

export function startTour(id: string, who: string, allSteps: TourStep[]) {
  active?.close();
  const visible = (sel?: string) => { if (!sel) return true; const el = document.querySelector<HTMLElement>(sel); return !!el && el.getClientRects().length > 0; };
  // Work out up front which steps apply (running each one's set-up, e.g. switching tab), so the count stays right
  const steps = allSteps.filter(st => { st.before?.(); return visible(st.target); });
  let i = 0;
  if (!steps.length) return;

  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `<div class="tour-spot" aria-hidden="true"></div>
    <div class="tour-pop" role="dialog" aria-modal="false" aria-labelledby="tour-title" tabindex="-1">
      <div class="tour-step" id="tour-count"></div>
      <h2 id="tour-title"></h2><div class="tour-body" id="tour-body"></div>
      <div class="tour-dots" aria-hidden="true"></div>
      <div class="tour-foot"><button type="button" class="linkbtn" data-t="skip">Skip tour</button>
        <span class="tour-sp"></span><button type="button" class="btn ghost sm" data-t="back">Back</button><button type="button" class="btn primary sm" data-t="next">Next</button></div>
    </div>`;
  document.body.append(root);
  const spot = root.querySelector<HTMLElement>('.tour-spot')!, pop = root.querySelector<HTMLElement>('.tour-pop')!;
  const lastFocus = document.activeElement as HTMLElement | null;

  function place() {
    const s = steps[i], el = s?.target ? document.querySelector<HTMLElement>(s.target) : null;
    const vw = innerWidth, vh = innerHeight, pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 14, pad = 6;
    if (!el) {
      spot.classList.add('none');
      pop.style.left = `${(vw - pw) / 2}px`; pop.style.top = `${Math.max(12, (vh - ph) / 2)}px`;
      return;
    }
    const r = el.getBoundingClientRect();
    spot.classList.remove('none');
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    // below if it fits, else above, else beside; always kept on screen
    let top = r.bottom + gap + pad, left = r.left + r.width / 2 - pw / 2;
    if (top + ph > vh - 12) top = r.top - gap - pad - ph;
    if (top < 12) { top = Math.min(Math.max(12, r.top), vh - ph - 12); left = r.right + gap + pad + pw < vw ? r.right + gap + pad : r.left - gap - pad - pw; }
    pop.style.left = `${Math.min(Math.max(12, left), vw - pw - 12)}px`;
    pop.style.top = `${Math.min(Math.max(12, top), vh - ph - 12)}px`;
  }

  function show(n: number) {
    // run the next step's set-up, then skip any whose target isn't there
    const dir = n >= i ? 1 : -1;
    while (n >= 0 && n < steps.length) { steps[n].before?.(); if (visible(steps[n].target)) break; n += dir; }
    if (n >= steps.length) { finish(); return; }
    i = Math.max(0, n);
    const s = steps[i];
    const shown = steps.length, pos = i + 1;
    root.querySelector('#tour-count')!.textContent = `${pos} of ${shown}`;
    root.querySelector('#tour-title')!.textContent = s.title;
    root.querySelector('#tour-body')!.innerHTML = s.body;
    root.querySelector('.tour-dots')!.innerHTML = Array.from({ length: shown }, (_, k) => `<i class="${k === pos - 1 ? 'on' : ''}"></i>`).join('');
    root.querySelector<HTMLButtonElement>('[data-t="back"]')!.hidden = pos <= 1;
    root.querySelector('[data-t="next"]')!.textContent = pos === shown ? 'Done' : 'Next';
    const el = s.target ? document.querySelector<HTMLElement>(s.target) : null;
    el?.scrollIntoView({ block: 'center', inline: 'nearest' });
    requestAnimationFrame(() => { place(); pop.focus({ preventScroll: true }); });
  }

  function finish() { markSeen(id, who); close(); }
  function close() {
    root.remove(); removeEventListener('resize', place); removeEventListener('scroll', place, true); document.removeEventListener('keydown', keys, true);
    active = null; lastFocus?.focus?.();
  }
  function keys(e: KeyboardEvent) {
    if (document.querySelector('dialog[open]')) return;   // a dialog the person opened while trying something
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
    else if (e.key === 'ArrowRight' && !(e.target as HTMLElement).matches('input,textarea,select')) show(i + 1);
    else if (e.key === 'ArrowLeft' && !(e.target as HTMLElement).matches('input,textarea,select')) show(i - 1);
  }
  root.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')?.dataset.t;
    if (t === 'next') show(i + 1); else if (t === 'back') show(i - 1); else if (t === 'skip') finish();
  });
  addEventListener('resize', place); addEventListener('scroll', place, true); document.addEventListener('keydown', keys, true);
  active = { close };
  show(0);
}
