/** Parse a DB timestamp as UTC (SQLite datetime('now') omits the Z suffix). */
export function parseUtc(ts: string): Date {
  return new Date(ts.endsWith('Z') ? ts : ts + 'Z');
}
