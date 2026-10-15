/**
 * One-off import: copy everything from the legacy SQLite database
 * (prisma/dev.db) into the PostgreSQL database at DATABASE_URL.
 *
 * Usage: DATABASE_URL=… npm run db:import-sqlite [path/to/dev.db]
 *
 * Rows are inserted in foreign-key order so constraints hold without
 * deferred tricks; booleans are converted from SQLite's 0/1.
 */
import { DatabaseSync } from "node:sqlite";
import pg from "pg";

const sqlitePath = process.argv[2] ?? "prisma/dev.db";
const url = process.env.DATABASE_URL;
if (!url?.startsWith("postgres")) {
  console.error("DATABASE_URL must be a postgresql:// URL.");
  process.exit(1);
}

// FK-safe order: every table after the tables it references.
const TABLES = [
  "User",
  "Session",
  "AccountProvider",
  "Course",
  "Module",
  "Lesson",
  "Source",
  "Prerequisite",
  "Assessment",
  "Attachment",
  "Progress",
  "Attempt",
  "GenerationRun",
  "Certificate",
];

// Columns Prisma models as Boolean — SQLite stores them as 0/1.
const BOOLEANS = {
  AccountProvider: ["active"],
  Attempt: ["correct"],
};

// Prisma stores SQLite DATETIMEs as epoch milliseconds; Postgres wants text
// it can cast — ISO-8601. Any numeric "…At" column gets converted.
function toParam(name, value) {
  if (value === null || value === undefined) return null;
  if (/[Aa]t$/.test(name) && typeof value === "number") {
    return new Date(value).toISOString();
  }
  if (/[Aa]t$/.test(name) && typeof value === "bigint") {
    return new Date(Number(value)).toISOString();
  }
  return value;
}

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();

let total = 0;
try {
  for (const table of TABLES) {
    const cols = sqlite.prepare(`PRAGMA table_info("${table}")`).all();
    if (cols.length === 0) {
      console.log(`  · ${table}: absent in SQLite, skipped`);
      continue;
    }
    const names = cols.map((c) => c.name);
    const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
    if (rows.length === 0) {
      console.log(`  · ${table}: 0 rows`);
      continue;
    }

    const boolCols = new Set(BOOLEANS[table] ?? []);
    const placeholders = names.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO "${table}" ("${names.join('", "')}") VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
    await client.query("BEGIN");
    try {
      // Execute per row so parameter counts stay manageable.
      for (const row of rows) {
        const values = names.map((n) => {
          const v = row[n];
          if (boolCols.has(n) && v !== null && v !== undefined) return v === 1 || v === true;
          return toParam(n, v);
        });
        await client.query(sql, values);
      }
      await client.query("COMMIT");
      total += rows.length;
      console.log(`  · ${table}: ${rows.length} rows`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`${table}: ${err.message}`);
    }
  }
  console.log(`Imported ${total} rows from ${sqlitePath} into PostgreSQL.`);
} finally {
  client.release();
  await pool.end();
  sqlite.close();
}
