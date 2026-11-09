import type { AccessConfig, AdminConfigResponse, AuditResponse, SaveAccessResponse, SavePeopleRequest, ViewAsRequest, ViewAsResponse } from '../../shared/types.ts';
import { call, send } from '../lib/http.ts';

export interface AdminApi {
  config(): Promise<AdminConfigResponse>;
  saveAccess(c: AccessConfig): Promise<SaveAccessResponse>;
  savePeople(users: AccessConfig['users']): Promise<SaveAccessResponse>;
  audit(): Promise<AuditResponse>;
  viewAs(email: string): Promise<ViewAsResponse>;
  viewAsStatus(): Promise<ViewAsResponse>;
  stopViewAs(): Promise<ViewAsResponse>;
}

export const remoteApi: AdminApi = {
  config: () => call('admin/config'),
  saveAccess: c => send<SaveAccessResponse, AccessConfig>('PUT', 'admin/access', c),
  savePeople: users => send<SaveAccessResponse, SavePeopleRequest>('PUT', 'admin/people', { users }),
  audit: () => call('admin/audit'),
  viewAs: email => send<ViewAsResponse, ViewAsRequest>('POST', 'viewas', { email }),
  viewAsStatus: () => call('viewas'),
  stopViewAs: () => send<ViewAsResponse>('POST', 'viewas/stop', {}),
};
