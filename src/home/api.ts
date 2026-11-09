import type { AddStaffRequest, Day, ImportStaffRequest, ImportStaffResponse, RemoveStaffRequest, SetDaysRequest, StaffResponse,
              StateResponse, ViewAsResponse } from '../../shared/types.ts';
import { call, send } from '../lib/http.ts';

export interface HomeApi {
  state(): Promise<StateResponse>;
  setDays(site: string, id: string, days: Day[], expectUpdatedAt?: string): Promise<StaffResponse>;
  add(r: AddStaffRequest): Promise<StaffResponse>;
  remove(site: string, id: string, reason: string): Promise<StaffResponse>;
  importList(r: ImportStaffRequest): Promise<ImportStaffResponse>;
  exportUrl(site: string): string;
  stopViewAs(): Promise<ViewAsResponse>;
}

export const remoteApi: HomeApi = {
  state: () => call('state'),
  setDays: (site, id, days, expectUpdatedAt) => send<StaffResponse, SetDaysRequest>('POST', 'staff/days', { site, id, days, expectUpdatedAt }),
  add: r => send<StaffResponse, AddStaffRequest>('POST', 'staff/add', r),
  remove: (site, id, reason) => send<StaffResponse, RemoveStaffRequest>('POST', 'staff/remove', { site, id, reason }),
  importList: r => send<ImportStaffResponse, ImportStaffRequest>('POST', 'staff/import', r),
  exportUrl: site => `/api/export?site=${encodeURIComponent(site)}`,
  stopViewAs: () => send<ViewAsResponse>('POST', 'viewas/stop', {}),
};
