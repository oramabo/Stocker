import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Minimal D1 shim over better-sqlite3 — enough of the surface that the Worker
 * uses (prepare / bind / all / first / run) to exercise the real routes in
 * tests without spinning up workerd.
 */
class Stmt {
  private args: unknown[] = [];
  constructor(
    private db: Database.Database,
    private sql: string,
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  private prepared() {
    return this.db.prepare(this.sql);
  }

  async all<T>() {
    const results = this.prepared().all(...(this.args as never[])) as T[];
    return { results, success: true, meta: {} };
  }

  async first<T>(): Promise<T | null> {
    const row = this.prepared().get(...(this.args as never[])) as T | undefined;
    return row ?? null;
  }

  async run() {
    const stmt = this.prepared();
    if (stmt.reader) stmt.all(...(this.args as never[]));
    else stmt.run(...(this.args as never[]));
    return { success: true, meta: {} };
  }
}

export function createTestDb(): any {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  const dir = join(import.meta.dirname ?? __dirname, '../../../db/migrations');
  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith('.sql')) db.exec(readFileSync(join(dir, file), 'utf8'));
  }

  return {
    prepare: (sql: string) => new Stmt(db, sql),
    _raw: db,
  };
}
