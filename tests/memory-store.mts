// In-memory stand-in for Netlify Blobs with the same etag / onlyIfMatch / onlyIfNew behaviour.
import type { BlobStore } from '../netlify/lib/store.mts';

export function memoryStore(): BlobStore {
  const mem = new Map<string, { d: unknown; e: number }>(); let ver = 0;
  return {
    async get(k, o) { const v = mem.get(k); return v === undefined ? null : (o?.type === 'json' ? structuredClone(v.d) : v.d); },
    async getWithMetadata(k) { const v = mem.get(k); return v ? { data: structuredClone(v.d), etag: String(v.e) } : null; },
    async setJSON(k, d, o = {}) {
      const v = mem.get(k);
      if (o.onlyIfNew && v) return { modified: false };
      if (o.onlyIfMatch && (!v || String(v.e) !== o.onlyIfMatch)) return { modified: false };
      mem.set(k, { d: structuredClone(d), e: ++ver }); return { modified: true };
    },
    async set(k, d) { mem.set(k, { d, e: ++ver }); },
    async list({ prefix }) { return { blobs: [...mem.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
    async delete(k) { mem.delete(k); },
  };
}
