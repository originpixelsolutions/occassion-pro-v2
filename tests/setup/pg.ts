import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');

/**
 * Spin up an in-memory Postgres (pglite) with citext loaded, apply every SQL
 * migration in `supabase/migrations/` in lexical order, then create the three
 * Supabase-style roles (`anon`, `authenticated`, `service_role`) so RLS tests
 * can switch identities with SET ROLE.
 *
 * Each call returns a fresh, isolated DB. Tests must close it in `afterEach`
 * or `afterAll`.
 */
export async function setupTestDb() {
  const db = new PGlite({ extensions: { citext } });
  await db.waitReady;

  // Apply all migrations in lexical order — same order Supabase CLI uses.
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await db.exec(sql);
  }

  // Create Supabase-style roles. pglite runs as the implicit superuser, so
  // we have to fabricate the role hierarchy here. `service_role` has
  // BYPASSRLS; `anon` and `authenticated` do not.
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
    END $$;

    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
      TO anon, authenticated, service_role;
  `);

  return db;
}

export type TestDb = Awaited<ReturnType<typeof setupTestDb>>;

/** Switch the current session's role. RESET ROLE to drop back to superuser. */
export async function asRole(db: TestDb, role: 'anon' | 'authenticated' | 'service_role') {
  await db.exec(`SET ROLE ${role};`);
}

export async function asSuperuser(db: TestDb) {
  await db.exec(`RESET ROLE;`);
}

/** Convenience: run `fn` as `role`, then always restore superuser. */
export async function withRole<T>(
  db: TestDb,
  role: 'anon' | 'authenticated' | 'service_role',
  fn: () => Promise<T>,
): Promise<T> {
  await asRole(db, role);
  try {
    return await fn();
  } finally {
    await asSuperuser(db);
  }
}
