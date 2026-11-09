// Puts the saved appearance settings on <html> before the page first paints, so there's no flash
// of the wrong theme. src/lib/settings.ts writes the cache and takes over once the page loads.
// A plain script (not a module) so it runs straight away; it's public because the sign-in page uses it too.
(function () {
  var html = document.documentElement, c = null;
  try { c = JSON.parse(localStorage.getItem('lwlat-settings-cache')); } catch (e) {}
  var mode = c && c.mode !== 'system' ? c.mode : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  html.classList.add(mode === 'dark' ? 'dark' : 'light');
  if (!c) return;
  (c.cls || []).forEach(function (x) { html.classList.add(x); });
  var p = c[mode] || {};
  for (var k in p) html.style.setProperty('--' + k, p[k]);
  html.style.setProperty('--ts', c.ts || 1);
  html.style.setProperty('--ui-zoom', c.zoom || 1);
})();
