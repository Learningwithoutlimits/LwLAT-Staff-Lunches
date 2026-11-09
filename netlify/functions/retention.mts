// Runs daily: deletes removed staff and change-log entries older than RETENTION_DAYS (shared/constants.ts).
// Scheduled functions run on the published production deploy only.
import { store, prune } from '../lib/store.mts';

export const config = { schedule: '@daily' };

export default async () => {
  const res = await prune(store());
  console.log(`Retention: removed ${res.removed} item(s) older than ${res.cutoff}`);
};
