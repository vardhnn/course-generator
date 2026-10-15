import { spawn, execSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const log = (m) => appendFileSync("probe5.log", `${new Date().toISOString()} ${m}\n`);

const start = Date.now();
log("probe5 start");

// Start `npm run dev` in the background.
const dev = spawn("npx", ["npm", "run", "dev"], {
  stdio: ["ignore", "pipe", "pipe"],
  shell: true,
});

let readyLine = null;
let nextPort = null;
dev.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  if (/Ready in/.test(text)) readyLine = text;
  const m = text.match(/Local:\s+http:\/\/localhost:(\d+)/);
  if (m) nextPort = m[1];
});
dev.stderr.on("data", (chunk) => {
  if (!/DeprecationWarning/.test(chunk.toString())) {
    log("stderr: " + chunk.toString().trim());
  }
});

log("waiting for Ready in…");
const waitReady = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timed out waiting for Ready in")), 90_000);
  const interval = setInterval(() => {
    if (readyLine) {
      clearInterval(interval);
      clearTimeout(timer);
      resolve();
    }
  }, 200);
});

try {
  await waitReady;
  log("readyLine=%s", readyLine.trim());
  await new Promise((r) => setTimeout(r, 800));
  if (!nextPort) throw new Error("no localhost port found");
  log("port=%s; running curl checks", nextPort);

  const base = "http://localhost:" + nextPort;
  const checks = [
    ["/", "home"],
    ["/library", "library"],
    ["/login", "login"],
    ["/course/does-not-exist", "missing_course"],
    ["/dashboard", "dashboard"],
    ["/generate", "generate"],
    ["/progress", "progress"],
    ["/certificates", "certificates"],
    ["/settings", "settings"],
  ];
  for (const [path, label] of checks) {
    const status = execSync(`curl -s -o /dev/null -w "%{http_code}" "${base}${path}"`, { encoding: "utf8" }).trim();
    log("%s=%s", label, status);
  }

  // Grab sample library HTML to confirm migrated courses render.
  const lib = execSync(`curl -s "${base}/library"`, { encoding: "utf8" });
  log("library_sample=%s", lib.includes("Distributed consensus") ? "has demo course" : "no demo course text");
} catch (err) {
  log("FAILED: %s", err.message);
} finally {
  dev.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  log("dev process signalled; checking survivors");
  const survivors = execSync("tasklist | findstr /i /c:node.exe /c:postgres.exe | head -6", { encoding: "utf8" }).trim();
  log("survivors=%s", survivors.replace(/\n/g, " "));
  const pgCount = parseInt(execSync("netstat -ano | findstr :54329 | findstr LISTENING | find /c /v """, { encoding: "utf8" }).trim(), 10) || 0;
  log("pg_after=%s", pgCount);
}

log("elapsed=%sms", Date.now() - start);
process.exit(0);
