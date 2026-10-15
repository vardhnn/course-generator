import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const log = (m) => appendFileSync("probe6.log", `${new Date().toISOString()} ${m}\n`);
const start = Date.now();
log("probe6 start");

const dev = spawn("npx", ["npm", "run", "dev"], {
  cwd: process.cwd(),
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
  const text = chunk.toString();
  if (!/DeprecationWarning/.test(text)) log("stderr: " + text.trim());
});

log("waiting for Ready in…");
const waitReady = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timed out waiting for Ready in")), 90_000);
  const interval = setInterval(() => {
    if (readyLine) { clearInterval(interval); clearTimeout(timer); resolve(); }
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
    const status = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", base + path]).stdout.toString().trim();
    log("%s=%s", label, status);
  }

  const lib = spawnSync("curl", ["-s", base + "/library"]).stdout.toString();
  log("library_sample=%s", lib.includes("Distributed consensus") ? "has demo course" : "no demo course text");
} catch (err) {
  log("FAILED: %s", err.message);
} finally {
  dev.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  log("dev process signalled; checking survivors");
  try {
    const survivors = spawnSync("tasklist", ["/FI", "IMAGENAME eq node.exe", "/FI", "IMAGENAME eq postgres.exe"]).stdout.toString();
    log("survivors=%s", survivors.trim().replace(/\r?\n/g, " "));
    const pgCount = spawnSync("netstat", ["-ano"]).stdout.toString().split("\n").filter((l) => l.includes(":54329") && l.includes("LISTENING")).length;
    log("pg_after=%s", pgCount);
  } catch (e) { log("survivor check failed: %s", e?.message ?? e); }
}

log("elapsed=%sms", Date.now() - start);
process.exit(0);
