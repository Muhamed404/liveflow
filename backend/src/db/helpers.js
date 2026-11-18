import { db } from './index.js';

// UPDATE only the fields that were provided (undefined = keep current value)
export function updateRow(table, keyColumns, fields) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return 0;
  const sets = entries.map(([k]) => `${k} = @${k}`).join(', ');
  const where = Object.keys(keyColumns).map((k) => `${k} = @__${k}`).join(' AND ');
  const params = Object.fromEntries(entries);
  for (const [k, v] of Object.entries(keyColumns)) params[`__${k}`] = v;
  return db.prepare(`UPDATE ${table} SET ${sets}, updated_at = datetime('now') WHERE ${where}`).run(params).changes;
}

export function toBool(row, ...cols) {
  if (!row) return row;
  for (const c of cols) row[c] = Boolean(row[c]);
  return row;
}
