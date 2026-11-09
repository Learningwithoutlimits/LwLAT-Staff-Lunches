// Shapes shared by the Netlify functions and the browser pages, so both sides agree on the API.
// Type-only: nothing here exists at runtime.
//
// The app: each site's staff list, and which weekdays (Monday to Friday) each person gets a free lunch.

// siteadmin: IT staff for some schools. The admin portal for those schools only.
export type Role = 'admin' | 'central' | 'siteadmin' | 'site' | 'blocked';
export type AccessRole = Role | 'none';

export interface Person { name: string; email: string }

/* ---------- access config (Netlify Blobs: config/access) ---------- */
export interface Site { code: string; name: string; domains: string[] }
export type PublicSite = Pick<Site, 'code' | 'name'>;
export interface UserRule { role: Role; sites: string[]; note: string; automatic?: boolean }
export interface GroupRule { groupId: string; label: string; role: Exclude<Role, 'blocked'>; sites: string[] }
export interface AccessConfig {
  sites: Site[];
  centralDomains: string[];
  groupRules: GroupRule[];
  users: Record<string, UserRule>;   // keyed by lower-case email
}

export interface Access {
  role: AccessRole;
  admin: boolean;
  sites: string[];
  manage: string[];                  // schools they can run in the admin portal: every one for admins, their own for site admins
  source: 'env' | 'person' | 'group' | 'domain' | null;
}

/* ---------- staff free lunches ---------- */
export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri';

/** One member of staff at one site, and the weekdays they get a free lunch. One list per site: staff/<SITE>. */
export interface StaffMember {
  id: string;
  site: string;
  name: string;
  jobTitle: string;
  email: string;                            // work email, lower case; '' if the staff list didn't have one
  days: Day[];                              // weekdays with a free lunch, Monday to Friday, in order
  createdAt: string; createdBy: Person;     // server-stamped, never changed by updates
  updatedAt: string; updatedBy: Person;     // server-stamped on every change
  removedAt?: string; removedBy?: Person; removedReason?: string;   // removed staff are kept (with the reason) until retention deletes them
}
/** A row from an imported staff list: only the columns the app needs are sent. */
export interface StaffRow { name: string; jobTitle?: string; email?: string }

export interface AuditRow { at: string; by: Person; action: 'access' | 'staff' | 'feedback' | 'system'; detail: string }
export interface SeenEntry { name: string; at: string; access: AccessRole; groups?: string[] }   // groups: Entra group IDs at last sign-in (for "view as")

/* ---------- API requests + responses ---------- */
export interface ApiError { error: string }

export interface StateResponse {
  user: Person; role: AccessRole; admin: boolean;
  sites: PublicSite[];
  manage: string[];            // sites whose staff list and free lunches this person can change (admins and site admins)
  staff: StaffMember[];        // current staff (not removed) at every site this person can see
  viewingAs?: Person | null;   // set while an admin is viewing the app as this person (read-only)
  feedback: boolean;           // the Feedback button is switched on (GITHUB_TOKEN set)
}
export interface StaffResponse { staff: StaffMember }
export interface StaffListResponse { site: string; staff: StaffMember[] }
export interface SetDaysRequest { site: string; id: string; days: Day[]; expectUpdatedAt?: string }
export interface AddStaffRequest extends StaffRow { site: string; days?: Day[] }
export interface RemoveStaffRequest { site: string; id: string; reason: string }
/** Import a full staff list for one site. New people are added with no free lunches; people already there keep theirs. */
export interface ImportStaffRequest { site: string; rows: StaffRow[]; removeMissing?: boolean; reason?: string }
export interface ImportStaffResponse extends StaffListResponse { added: number; updated: number; removed: number; unchanged: number }
export interface ViewAsRequest { email: string }
export interface ViewAsResponse { viewingAs: Person | null }

export type FeedbackKind = 'bug' | 'idea' | 'question';
export interface FeedbackRequest { kind: FeedbackKind; message: string; impact?: 'blocked' | 'slowed' | 'minor'; details?: string }
export interface FeedbackResponse { number: number }

export interface AdminConfigResponse {
  me: Person;
  /** false for a site admin: config then only holds their schools and the people they can manage */
  full: boolean;
  config: AccessConfig;
  envAdmins: string[];
  seen: Record<string, SeenEntry>;
  seenAccess: Record<string, Access>;
  health: HealthState | null;
}
export interface SavePeopleRequest { users: Record<string, UserRule> }
export interface SaveAccessResponse { config: AccessConfig }
export interface AuditResponse { rows: AuditRow[] }

/** meta/health: written by the scheduled health check, shown on the admin portal */
export interface HealthState {
  checkedAt: string;
  ok: boolean;
  failures: number;            // consecutive failed checks
  problem: string | null;
  alertedAt: string | null;    // last "site is having problems" email
  lastBackup: string | null;   // YYYY-MM-DD of the last daily backup
  expiries: { name: string; expires: string | null; daysLeft: number | null }[];
}
