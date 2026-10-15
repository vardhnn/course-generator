import { appendFileSync } from "node:fs";
const log = (m) => appendFileSync("probe.log", m + "\n");
log("step: ensuring…");
const { ensureLocalDatabase } = await import("./scripts/local-db.mjs");
const pg = await ensureLocalDatabase();
log("step: handle? " + !!pg);
if (pg) {
  log("step: stopping…");
  const done = await Promise.race([
    pg.stop().then(() => "stop resolved"),
    new Promise((r) => setTimeout(() => r("stop HUNG 8s"), 8000)),
  ]);
  log("step: " + done);
}
log("step: end");
