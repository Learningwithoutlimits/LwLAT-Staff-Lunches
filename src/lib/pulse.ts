// "Back to Pulse": links to the LwLAT Pulse portal, as in the HR KPIs dashboard.
// Going there covers the page with an "Opening LwLAT Pulse…" screen straight away; the browser keeps
// showing it until Pulse starts to draw, so the wait doesn't look like a blank page.
// Ctrl/Cmd-click and middle-click still open Pulse in a new tab as normal.

export const PULSE_URL = import.meta.env.VITE_PULSE_URL || 'https://pulse.lwlat.org.uk/';

export function initPulseLinks() {
  document.querySelectorAll<HTMLAnchorElement>('a[data-pulse]').forEach(a => { a.href = PULSE_URL; });
  const pulse = new URL(PULSE_URL).origin;
  const veil = document.createElement('div');
  veil.id = 'veil';
  veil.setAttribute('role', 'status');
  veil.innerHTML = '<div class="veil-in"><svg class="veil-pulse" viewBox="0 0 120 40" aria-hidden="true"><path d="M2 20h30l8-16 16 32 10-22 6 6h46"/></svg><b>Opening LwLAT Pulse</b><span>Just a moment…</span></div>';
  document.body.append(veil);
  document.addEventListener('click', e => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || a.target === '_blank') return;
    if (new URL(a.href, location.href).origin !== pulse) return;
    e.preventDefault();
    veil.classList.add('on');
    // Let the screen paint before the browser starts leaving the page.
    requestAnimationFrame(() => requestAnimationFrame(() => { location.href = a.href; }));
  });
  // Coming back with the browser's Back button restores this page from cache: take the screen away.
  addEventListener('pageshow', () => veil.classList.remove('on'));
}
