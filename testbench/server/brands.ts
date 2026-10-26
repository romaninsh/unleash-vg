import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { BrandSource } from './config.ts';

export interface Brand {
  key: string;
  displayName: string;
  active: boolean;
}

export interface BrandResult {
  brands: Brand[];
  source: string;
  error?: string;
}

/** Read-only brand listing straight from each implementation's database. */
export async function listBrands(src: BrandSource): Promise<BrandResult> {
  try {
    switch (src.type) {
      case 'sqlite':
        return { source: `sqlite:${src.path}`, brands: readSqlite(src.path) };
      case 'surreal':
        return { source: `surreal:${src.url} ${src.ns}/${src.db}`, brands: await readSurreal(src) };
      case 'static':
        return {
          source: 'static',
          brands: src.brands.map((b) => ({ key: b.key, displayName: b.displayName ?? b.key, active: true })),
        };
    }
  } catch (e) {
    return { source: src.type, brands: [], error: (e as Error).message };
  }
}

function readSqlite(path: string): Brand[] {
  if (!existsSync(path)) throw new Error(`database file not found: ${path}`);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db
      .prepare('SELECT key, display_name AS displayName, active FROM brands ORDER BY key')
      .all() as { key: string; displayName: string; active: number }[];
    return rows.map((r) => ({ key: r.key, displayName: r.displayName, active: Boolean(r.active) }));
  } finally {
    db.close();
  }
}

async function readSurreal(src: Extract<BrandSource, { type: 'surreal' }>): Promise<Brand[]> {
  const res = await fetch(`${src.url}/sql`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${src.user}:${src.pass}`).toString('base64'),
      // Newer SurrealDB uses surreal-ns/surreal-db, older versions NS/DB.
      'surreal-ns': src.ns,
      'surreal-db': src.db,
      NS: src.ns,
      DB: src.db,
    },
    body: 'SELECT key, display_name, active FROM brand ORDER BY key;',
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SurrealDB HTTP ${res.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text) as { status: string; result: any }[];
  const first = body[0];
  if (!first || first.status !== 'OK') throw new Error(`SurrealDB query failed: ${JSON.stringify(first?.result)}`);
  return (first.result as any[]).map((r) => ({
    key: String(r.key),
    displayName: String(r.display_name ?? r.key),
    active: r.active !== false,
  }));
}
