// Feedback button (bottom right of every page). Sends a bug, idea or question to the app's GitHub issues
// through /api/feedback, so nobody needs a GitHub account and no names go to GitHub.
// Recent errors on the page are collected (emails and IDs removed on the server) and offered as technical details.
import { esc } from './dom.ts';
import { send } from './http.ts';
import type { FeedbackRequest, FeedbackResponse } from '../../shared/types.ts';

const recent: string[] = [];
const note = (s: string) => { recent.push(`${new Date().toISOString().slice(11, 19)} ${s}`.slice(0, 300)); if (recent.length > 8) recent.shift(); };
window.addEventListener('error', e => note(`Script error: ${e.message}`));
window.addEventListener('unhandledrejection', e => note(`Failed: ${String((e.reason as Error)?.message ?? e.reason)}`));

let dlg: HTMLDialogElement | null = null;

function build() {
  dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog">
    <div class="mhead"><div class="eb">Feedback</div><h2>Tell us what you think</h2></div>
    <div class="mbody">
      <div class="seg" role="group" aria-label="Kind">${(['bug', 'idea', 'question'] as const).map((k, i) =>
        `<button type="button" data-kind="${k}" aria-pressed="${i === 0}">${k === 'bug' ? 'Something is wrong' : k === 'idea' ? 'An idea' : 'A question'}</button>`).join('')}</div>
      <label class="lab">What happened, or what would help?<textarea class="in" name="message" rows="5" maxlength="4000" required></textarea></label>
      <label class="lab" data-impact>How much does it affect you?<select class="in" name="impact">
        <option value="minor">Minor</option><option value="slowed">It slows me down</option><option value="blocked">I can't carry on</option></select></label>
      <label class="check"><input type="checkbox" name="details" checked> Include technical details (page, browser, screen size, recent errors; no names)</label>
      <div class="err" role="alert"></div>
    </div>
    <div class="mfoot"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">Send</button></div></form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form')!;
  let kind: FeedbackRequest['kind'] = 'bug';
  dlg.querySelector('.seg')!.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]'); if (!b) return;
    kind = b.dataset.kind as FeedbackRequest['kind'];
    dlg!.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    dlg!.querySelector<HTMLElement>('[data-impact]')!.hidden = kind !== 'bug';
  });
  dlg.querySelector('[data-close]')!.addEventListener('click', () => dlg!.close());
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(form), err = dlg!.querySelector<HTMLElement>('.err')!;
    const details = f.get('details') ? [`Page: ${location.pathname}`, `Browser: ${navigator.userAgent}`,
      `Screen: ${innerWidth}×${innerHeight}`, `Theme: ${document.documentElement.className}`, ...recent].join('\n') : undefined;
    try {
      const { number } = await send<FeedbackResponse, FeedbackRequest>('POST', 'feedback',
        { kind, message: String(f.get('message')), impact: kind === 'bug' ? f.get('impact') as FeedbackRequest['impact'] : undefined, details });
      dlg!.close(); form.reset();
      dlg!.dispatchEvent(new CustomEvent('sent', { bubbles: true, detail: number }));
    } catch (x) { err.textContent = (x as Error).message; }
  });
}

/** Add the Feedback button. Call once the page knows feedback is switched on. */
export function initFeedback(onSent: (n: number) => void) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn primary fbbtn'; b.textContent = 'Feedback';
  b.addEventListener('click', () => { if (!dlg) { build(); dlg!.addEventListener('sent', e => onSent((e as CustomEvent<number>).detail)); } dlg!.showModal(); });
  document.body.append(b);
}

/** For an unexpected error: a "Report this problem" link that opens the box with the error filled in. */
export const reportLink = (message: string) =>
  `<button type="button" class="linkbtn" data-report="${esc(message)}">Report this problem</button>`;
document.addEventListener('click', e => {
  const m = (e.target as HTMLElement).closest<HTMLElement>('[data-report]')?.dataset.report;
  if (!m) return;
  note(`Reported: ${m}`);
  document.querySelector<HTMLButtonElement>('.fbbtn')?.click();
  const t = dlg?.querySelector<HTMLTextAreaElement>('textarea'); if (t && !t.value) t.value = `I saw this error: ${m}\n\n`;
});
