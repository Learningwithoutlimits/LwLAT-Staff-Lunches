// Small DOM helpers shared by the register and admin pages.

/** querySelector for elements that are always in the page's markup. */
export const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** An <input>, <select> or <textarea>. */
export type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export const field = (sel: string) => $<Field>(sel);

/** The element an event came from (events here are always on elements). */
export const target = (e: Event) => e.target as HTMLElement;

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** `vite --mode demo`: in-memory data, no server or sign-in. Compiled out of production builds. */
export const DEMO = import.meta.env.MODE === 'demo';

/** Resolve with a copy after a short pause, so demo data behaves like a network call. */
export const demoDelay = <T,>(v: T) => new Promise<T>(res => setTimeout(() => res(structuredClone(v)), 80));
