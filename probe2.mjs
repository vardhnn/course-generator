import { appendFileSync } from "node:fs";
import { LOCAL_DB, startLocalDatabase } from "./scripts/local-db.mjs";

const t0 = Date.now();
appendFileSync("p2.log", `started at ${t0}\n`);
const log = (m, ...args) => appendFileSync("p2.log", `[${Date.now()-t0}] ${m}\n`);

const targetPort = LOCAL_DB.port;
const step = (name, block) => {
  log("step %s begin", name);
  try {
    block();
    log("step %s ok", name);
  } catch (e) {
    log("step %s FAILED: %s", name, e?.message ?? e);
  }
};

let pgHandle = null;
let ensureFailed = false;

step("ensure", async () => {
  pgHandle = await startLocalDatabase({ port: targetPort });
  log("handle: %s", !!pgHandle);
});

// A few synchronous steps in between so the log shows real progress.
step("poll1", () => log("poll1 tick"));
step("poll2", () => log("poll2 tick"));

step("stop", async () => {
  if (!pgHandle) { log("no handle"); return; }
  try { await pgHandle.stop() } catch (e) { log("stop#1 threw: %s", e?.message ?? e) }
});

step("stop2", async () => {
  if (!pgHandle) { log("no handle"); return; }
  try { await pgHandle.stop() } catch (e) { log("stop#2 threw: %s", e?.message ?? e) }
});

step("final", () => log("finalize"));

const elapsed = Date.now() - t0;
log("elapsed=%sms done", elapsed);

// On this platform a Postgres child can keep Node alive even after our async
// work finishes, so force the process to exit so the shell never hangs.
setTimeout(() => process.exit(0), 2000).unref?.();
