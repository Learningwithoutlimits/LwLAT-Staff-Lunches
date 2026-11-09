// Theme palettes, ported from the IT staff rota's settings engine so both apps look and behave alike.
//
// Themes are seeds, not hand-written palettes: each picks an accent hue and a neutral tint, and
// buildPalette() generates every colour the UI uses from those in OKLCH, with the same lightness
// rules per mode. So any theme in light or dark keeps the same contrast, and high contrast is just
// a different set of inputs to the same generator. Pure functions: no DOM, so the tests can check it.

export type Mode = 'light' | 'dark';
export interface Theme { name: string; ah: number; ac: number; nh: number; nc: number; wh: number }
export type Palette = Record<string, string>;
export interface PaletteOptions { contrast?: boolean; tint?: number }
interface Colour { hex: string; rgb: number[]; lum: number }

// ── OKLCH → sRGB ──────────────────────────────────────────────
function oklchToLinear(L: number, C: number, h: number) {
  const hr = h * Math.PI / 180, a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const inGamut = (rgb: number[]) => rgb.every(v => v >= -0.0001 && v <= 1.0001);
const encode = (v: number) => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
const lumOf = (lin: number[]) => 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];

/** OKLCH colour; chroma is reduced until it fits sRGB, so hue and lightness are kept. */
export function color(L: number, C: number, h: number): Colour {
  let lin = oklchToLinear(L, C, h);
  if (!inGamut(lin)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid; else hi = mid;
    }
    lin = oklchToLinear(L, lo, h);
  }
  const c = lin.map(v => Math.min(1, Math.max(0, v)));
  const rgb = c.map(v => Math.round(encode(v) * 255));
  return { hex: '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join(''), rgb, lum: lumOf(c) };
}
export const contrast = (a: { lum: number }, b: { lum: number }) => (Math.max(a.lum, b.lum) + 0.05) / (Math.min(a.lum, b.lum) + 0.05);
/** Parse #rrggbb back into a colour, for contrast checks. */
export function hex(h: string): Colour {
  const rgb = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  return { hex: h, rgb, lum: lumOf(rgb.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })) };
}
const rgba = (c: Colour, alpha: number) => `rgba(${c.rgb.join(',')},${alpha})`;

// ── Tone rules per mode ───────────────────────────────────────
// [lightness, chroma] pairs for the status families (ok / warn / danger)
const TONES = {
  light: {
    canvas: .965, bg: .995, bg2: .952, bg3: .922, segTrack: .918,
    text: .22, text2: .40, text3: .52, borderA: .09, border2A: .16, accentL: .52,
    hdr: [.60, .45, .31], hdrSoft: .92,
    status: { bg: [.945, .05], txt: [.40, .11], line: [.78, .10], solid: [.50, .15] },
  },
  dark: {
    canvas: .165, bg: .205, bg2: .235, bg3: .275, segTrack: .150,
    text: .95, text2: .78, text3: .65, borderA: .07, border2A: .13, accentL: .79,
    hdr: [.40, .31, .22], hdrSoft: .88,
    status: { bg: [.29, .055], txt: [.87, .09], line: [.58, .11], solid: [.62, .15] },
  },
};
type Tones = typeof TONES.light;
const HIGH_CONTRAST: Record<Mode, Partial<Omit<Tones, 'status'>> & { status?: Partial<Tones['status']> }> = {
  light: { canvas: .975, text: .12, text2: .26, text3: .38, borderA: .22, border2A: .38, accentL: .42,
           status: { txt: [.30, .10], solid: [.44, .15] } },
  dark:  { canvas: .10, bg: .15, bg2: .19, bg3: .24, segTrack: .10,
           text: 1, text2: .93, text3: .83, borderA: .24, border2A: .42, accentL: .85,
           status: { txt: [.94, .07], solid: [.70, .15] } },
};
// Status hues stay recognisable in every theme: green = good, amber = warning, red = bad
const STATUS_HUES = { ok: 150, warn: 78, danger: 25 };

// ── Themes ─────────────────────────────────────────────────────
// ah/ac = accent hue/chroma, nh/nc = neutral tint hue/chroma (how much the theme's colour carries
// into backgrounds and borders), wh = second hue for the background glow. Same set as the staff rota.
export const THEMES: Record<string, Theme> = {
  default: { name: 'LwLAT Teal', ah: 192, ac: .11, nh: 200, nc: .009, wh: 250 },
  ocean:   { name: 'Ocean',      ah: 255, ac: .15, nh: 248, nc: .017, wh: 195 },
  indigo:  { name: 'Indigo',     ah: 272, ac: .17, nh: 270, nc: .020, wh: 305 },
  violet:  { name: 'Violet',     ah: 290, ac: .15, nh: 285, nc: .022, wh: 330 },
  berry:   { name: 'Berry',      ah: 345, ac: .16, nh: 345, nc: .020, wh: 290 },
  coral:   { name: 'Coral',      ah: 32,  ac: .15, nh: 40,  nc: .016, wh: 5   },
  slate:   { name: 'Slate',      ah: 255, ac: .05, nh: 250, nc: .012, wh: 230 },
};
export const DEFAULT_THEME = 'default';

// How strongly each surface takes the neutral tint, per mode (a little gentler than the rota, so tables stay calm)
const TINT = {
  light: { canvas: 1.8, bg: .5, bg2: 1.6, bg3: 2, seg: 2, text2: 3, text3: 3, border: 3, wash1: .10, wash2: .07, soft: .32 },
  dark:  { canvas: 1.8, bg: 1.6, bg2: 1.9, bg3: 2.2, seg: 1.9, text2: 3, text3: 3, border: 4, wash1: .13, wash2: .08, soft: .38 },
};

/** Every colour token (as CSS custom property names without the --) for one theme + mode. */
export function buildPalette(theme: Theme, mode: Mode, opts: PaletteOptions = {}): Palette {
  const t: Tones = { ...TONES[mode] };
  if (opts.contrast) {
    const hc = HIGH_CONTRAST[mode];
    Object.assign(t, hc, { status: { ...t.status, ...hc.status } });
  }
  // Colour intensity (Subtle / Balanced / Vivid). High contrast caps it so tints never eat into text contrast.
  const k = Math.min(opts.tint ?? 1, opts.contrast ? .6 : 9);
  const tw = TINT[mode];
  const { nh, nc } = theme;
  const n = (L: number, mult: number, cap = .2) => color(L, Math.min(nc * mult * k, cap), nh);
  const out: Palette = {};
  const surface = n(t.bg, tw.bg);

  // Pale backgrounds read as more saturated than they measure, so the canvas gets a ceiling
  const canvasCap = (mode === 'dark' ? .04 : .032) * k;
  const canvas = n(t.canvas, tw.canvas, canvasCap);
  out.canvas  = canvas.hex;
  out.bg      = surface.hex;
  out.bg2     = n(t.bg2, tw.bg2).hex;
  out.bg3     = n(t.bg3, tw.bg3).hex;
  out.text    = color(t.text, Math.min(nc * 2, .025), nh).hex;
  out.text2   = n(t.text2, tw.text2, .045).hex;
  out.text3   = n(t.text3, tw.text3, .05).hex;
  const line  = n(mode === 'dark' ? .8 : .35, tw.border, .08);
  out.border  = rgba(line, +(t.borderA * (mode === 'dark' ? 1.1 : 1)).toFixed(3));
  out.border2 = rgba(line, +(t.border2A * (mode === 'dark' ? 1.1 : 1)).toFixed(3));
  out['seg-track']  = n(t.segTrack, tw.seg).hex;
  out['seg-active'] = mode === 'dark' ? n(t.bg3 + .03, tw.bg3).hex : surface.hex;

  const accent = color(t.accentL, theme.ac, theme.ah);
  // Second stop for two-tone buttons: same lightness, hue nudged towards the glow colour
  const shift = ((theme.wh - theme.ah + 540) % 360) - 180;
  const accent2 = color(t.accentL - .02, theme.ac, theme.ah + Math.sign(shift) * Math.min(28, Math.abs(shift)));
  const white = color(1, 0, 0), ink = color(.2, Math.min(theme.ac * .4, .04), theme.ah);
  out.accent        = accent.hex;
  out['accent-2']   = accent2.hex;
  out['accent-rgb'] = accent.rgb.join(', ');
  const onWhite = Math.min(contrast(accent, white), contrast(accent2, white));
  const onInk   = Math.min(contrast(accent, ink), contrast(accent2, ink));
  out['on-accent'] = onWhite >= onInk ? '#ffffff' : ink.hex;
  out['accent-soft'] = color(mode === 'dark' ? t.bg + .045 : .955, Math.min(theme.ac * tw.soft * k, .06), theme.ah).hex;
  // Soft glow of the accent across the top of the page
  out['wash-1'] = rgba(accent, +Math.min(tw.wash1 * k, .22).toFixed(3));
  out['wash-2'] = rgba(color(mode === 'dark' ? .6 : .7, .14, theme.wh), +Math.min(tw.wash2 * k, .16).toFixed(3));

  // Branded header band: a deep gradient of the accent hue, always with white text on it
  const hc = Math.max(theme.ac, .04) * (mode === 'dark' ? .8 : .95);
  t.hdr.forEach((L, i) => { out[`hdr-${i + 1}`] = color(opts.contrast ? L - .08 : L, hc, theme.ah).hex; });
  out['hdr-soft'] = color(t.hdrSoft, Math.min(theme.ac * .55, .07), theme.ah).hex;

  for (const [name, h] of Object.entries(STATUS_HUES)) {
    for (const [role, [L, C]] of Object.entries(t.status)) out[`${name}-${role}`] = color(L, C, h).hex;
    const solid = color(t.status.solid[0], t.status.solid[1], h), dark = color(.18, .03, h);
    out[`${name}-on`] = contrast(solid, white) >= contrast(solid, dark) ? '#ffffff' : dark.hex;
  }
  return out;
}
