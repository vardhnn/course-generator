import { appendFileSync } from "node:fs";
import { LOCAL_DB } from "./scripts/local-db.mjs";

const T = (label, start) => appendFileSync("probe.log", `${Date.now()-start} ${label}\n`);

const startLog = Date.now();
appendFileSync("probe.log", `started at ${startLog}\n`);

try {
  const LocalDB = await import("./scripts/local-db.mjs");
  LocalDB.startLocalDatabase().then((pg) => {
    T("started ok (" + !!pg + ")", startLog);
    const ready = setInterval(() => T("poke", startLog), 500);
    setTimeout(() => { try { pg?.stop() } catch {}
      LocalDB.waitForServer(LOCAL_DB.port, 2000).then((up) => T("after stop reachable=" + up, startLog));
    }, 1500);
    setTimeout(() => process.exit(0), 3000);
  }).catch((err) => {
    T("start FAILED: " + err.message, startLog);
    process.exit(1);
  });
} catch (err) {
  T("import FAILED: " + err.message, startLog);
  process.exit(1);
}
