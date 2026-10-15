/**
 * Vitest setup. Runs before every test file.
 *
 * Forces the local generator and a disposable SQLite file so a test run can
 * never spend real API credits or touch the development database.
 */
process.env.AI_PROVIDER = "mock";
process.env.EXA_API_KEY = "";
delete process.env.GEMINI_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENAI_API_KEY;
// DATABASE_URL/DIRECT_URL come from the globalSetup's disposable embedded
// PostgreSQL — never fall back to the development database. Refusing to run
// beats wiping dev data: the suites `db push --force-reset` whatever this
// points at.
if (!process.env.DATABASE_URL?.includes("54330/rcs_test")) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL is "${process.env.DATABASE_URL}" instead of the disposable rcs_test database.`,
  );
}
