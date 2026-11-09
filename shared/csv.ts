// CSV export that opens cleanly in Excel. Every cell is quoted, and cells that Excel would run as a
// formula (starting = + - @, tab or carriage return) get a leading apostrophe, so exported data can
// never run as a formula (CSV injection). The BOM makes Excel read the file as UTF-8.

export const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};

export const toCsv = (header: string[], rows: unknown[][]) =>
  '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
