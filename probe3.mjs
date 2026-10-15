import { appendFileSync } from "node:fs";
import { LOCAL_DB, startLocalDatabase } from "./scripts/local-db.mjs";

const t0 = Date.now();
appendFileSync("probe3.log", `started at ${t0}\n`);
const log = (m, ...args) => appendFileSync("probe3.log", `[${Date.now()-t0}] ${m}\n`);

async function main() {
  log("starting…");
  try {
    const pg = await startLocalDatabase({ port: LOCAL_DB.port });
    log("started; handle: %s", !!pg);

    log("waiting 200ms…");
    await new Promise((r) => setTimeout(r, 200));

    const reachable = await import("pg").then(({ Client }) =>
      new Client({ host: "localhost", port: LOCAL_DB.port, user: LOCAL_DB.user, password: LOCAL_DB.password, database: "postgres" }).connect().then(() => true, () => false).finally((c) => c.end().catch(() => {}))
    );
    log("reachable: %s", reachable);

    log("stopping…");
    await pg?.stop().catch((e) => log("stop threw: %s", e?.message ?? e));
    log("stop resolved");
  } catch (err) {
    log("FAILED: %s", err.message);
  }
  log("elapsed=%sms done", Date.now() - t0);
}

main().then(() => {
  // On this platform a Postgres child can keep Node alive after our async work
  // ends, so force exit so the shell never hangs.
  setTimeout(() => process.exit(0), 2000).unref?.();
}).catch((err) => {
  appendFileSync("probe3.log", `FATAL ${err.message}\n`);
  setTimeout(() => process.exit(1), 2000).unref?.();
});
