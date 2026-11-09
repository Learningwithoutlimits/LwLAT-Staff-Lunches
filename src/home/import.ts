// Reads a staff list exported from SIMS, Arbor, an HR system or Excel ("Save as CSV").
// Runs in the browser: the file never leaves the PC, and only name, job title and email are sent to the server.
// No DOM here, so the tests can run it in Node.
import type { StaffMember, StaffRow } from '../../shared/types.ts';

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes. Also reads tab- or semicolon-separated files. */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', '\t', ';'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');
const find = (headers: string[], names: string[]) => headers.findIndex(h => names.includes(norm(h)));

export interface Columns { name: number; first: number; last: number; jobTitle: number; email: number }

/** Works out which columns hold what, from the header row. */
export function detectColumns(headers: string[]): Columns {
  return {
    name: find(headers, ['name', 'fullname', 'staffname', 'employeename', 'displayname', 'preferredname', 'legalname']),
    first: find(headers, ['firstname', 'forename', 'forenames', 'givenname', 'preferredforename', 'legalforename']),
    last: find(headers, ['surname', 'lastname', 'familyname', 'preferredsurname', 'legalsurname']),
    // not "Title": in SIMS that's Mr / Mrs / Ms
    jobTitle: find(headers, ['jobtitle', 'role', 'position', 'post', 'jobrole', 'staffrole', 'roledescription']),
    email: find(headers, ['email', 'emailaddress', 'workemail', 'schoolemail', 'mail', 'userprincipalname', 'upn']),
  };
}

export interface ImportPreview {
  rows: StaffRow[];            // what will be sent
  warnings: string[];
  added: StaffRow[];           // not on the list yet
  kept: number;                // already on the list (their free lunches stay as they are)
  missing: StaffMember[];      // on the list now, but not in the file
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const key = (r: { name: string; email?: string }) => (r.email || '').toLowerCase() || 'name:' + r.name.toLowerCase();

/** Turn the file into rows and compare them with the site's current list. Throws with a plain-English message if it can't be read. */
export function previewImport(text: string, current: StaffMember[]): ImportPreview {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error('The file needs a header row and at least one member of staff.');
  const [headers, ...body] = table;
  const col = detectColumns(headers);
  if (col.name < 0 && (col.first < 0 || col.last < 0))
    throw new Error('Couldn\'t find a name column. The first row needs a "Name" column, or "First name" and "Surname" columns.');
  const warnings: string[] = [];
  if (col.email < 0) warnings.push('No email column, so people are matched by name. Two people with the same name would count as one.');
  const cell = (r: string[], i: number) => i < 0 ? '' : (r[i] ?? '').trim().replace(/\s+/g, ' ');
  const seen = new Map<string, StaffRow>();
  let noName = 0, badEmail = 0, dupes = 0;
  for (const r of body) {
    const name = cell(r, col.name) || [cell(r, col.first), cell(r, col.last)].filter(Boolean).join(' ');
    if (!name) { noName++; continue; }
    let email = cell(r, col.email).toLowerCase();
    if (email && !EMAIL.test(email)) { badEmail++; email = ''; }
    const row: StaffRow = { name: name.slice(0, 100), jobTitle: cell(r, col.jobTitle).slice(0, 100), email };
    if (seen.has(key(row))) dupes++;
    seen.set(key(row), row);
  }
  if (noName) warnings.push(`${noName} row${noName === 1 ? '' : 's'} with no name will be skipped.`);
  if (badEmail) warnings.push(`${badEmail} email address${badEmail === 1 ? " doesn't" : "es don't"} look right, so ${badEmail === 1 ? 'that person is' : 'those people are'} matched by name instead.`);
  if (dupes) warnings.push(`${dupes} repeated row${dupes === 1 ? '' : 's'} will only be added once.`);
  const rows = [...seen.values()];
  if (!rows.length) throw new Error('No staff were found in the file.');
  if (rows.length > 3000) throw new Error('That file has more than 3,000 people. Import one site at a time.');
  const now = new Set(current.map(key)), incoming = new Set(rows.map(key));
  return { rows, warnings, added: rows.filter(r => !now.has(key(r))), kept: rows.filter(r => now.has(key(r))).length,
    missing: current.filter(s => !incoming.has(key(s))) };
}
