// Sign-in page. Deliberately has no imports: it loads before sign-in, so its bundle must stay
// self-contained in /signin-assets (everything else is behind the edge gate).
const q = new URLSearchParams(location.search);
const returnTo = q.get('returnTo');
const signin = document.getElementById('signin') as HTMLAnchorElement;
if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) signin.href = '/auth/login?returnTo=' + encodeURIComponent(returnTo);
const MESSAGES: Record<string, [cls: string, html: string]> = {
  noaccess: ['err', 'You signed in as <b>WHO</b>, but that account hasn\'t been given access to this app yet. Ask the app\'s administrators to add you, or sign in with a different account.'],
  microsoft: ['err', 'Microsoft couldn\'t sign you in. Please try again.'],
  token: ['err', 'Sign-in couldn\'t be completed. Please try again.'],
  state: ['err', 'Your sign-in link had expired. Please try again.'],
  expired: ['err', 'Your sign-in took too long. Please try again.'],
};
const box = document.getElementById('msg')!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const error = q.get('error');
if (q.get('signedout') || location.pathname === '/signed-out') { box.className = 'msg ok show'; box.textContent = "You've signed out of the app and of Microsoft."; }
else if (error && Object.hasOwn(MESSAGES, error)) {
  const [cls, html] = MESSAGES[error];
  box.className = `msg ${cls} show`; box.innerHTML = html.replace('WHO', esc(q.get('who') || 'that account'));
}
