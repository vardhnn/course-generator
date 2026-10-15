import { spawn, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const log = (m, ...a) => {
  const msg = String(m).replace(/%/g, "%%");
  let filled = msg;
  for (const v of a) filled = filled.replace(/%s/, () => String(v));
  appendFileSync("smoke.log", `${new Date().toISOString()} ${filled}\n`);
};

const start = Date.now();
log("start");

const dev = spawn("npm", ["run", "dev", "--", "-p", "3000"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
  shell: true,
});

let envLine = null;
let readyLine = null;
let nextPort = null;

dev.stderr.on("data", (chunk) => {
  const text = chunk.toString().trim();
  if (/DeprecationWarning/.test(text)) return;
  if (/Environment variables loaded from/.test(text) && !envLine) envLine = text;
  log("stderr> " + text);
});

log("waiting for env…");
const envRead = new Promise((resolve) => {
  const check = () => { if (envLine) resolve(envLine); else setTimeout(check, 200); };
  check();
});
await envRead;
log("envLine=%s", envLine);

try {
  const old = spawnSync("netstat", ["-ano"]).stdout.toString().split("\n").find((l) => l.includes(":3000") && l.includes("LISTENING"));
  if (old) {
    const pid = old.trim().split(/\s+/).pop();
    spawnSync("taskkill", ["//F", "//PID", String(pid)]);
    log("killed_stale_pid=%s", pid);
    await sleep(1500);
  }
} catch {}

dev.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  if (/Ready in/.test(text)) readyLine = text.trim();
  const m = text.match(/Local:\s+http:\/\/localhost:(\d+)/);
  if (m) nextPort = m[1];
});

log("waiting for Ready in…");
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timed out waiting for Ready in")), 90_000);
  const check = () => { if (readyLine) { clearTimeout(timer); resolve(readyLine); } else setTimeout(check, 200); };
  check();
});
log("readyLine=%s", readyLine);
await sleep(900);

if (!nextPort) throw new Error("no localhost port found");
log("devPort=%s", nextPort);

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
  const code = spawnSync("curl", ["-s", "-o", "nul", "-w", "%{http_code}", base + path]).stdout.toString().trim();
  if (code) log("%s=%s", label, code);
}
const lib = spawnSync("curl", ["-s", base + "/library"]).stdout.toString();
log("library_html_has_demo=%s", lib.includes("Distributed consensus") || lib.includes("course-card") ? "yes" : "no");
log("library_html_sample=%s", lib.slice(0, 400).replace(/\s+/g, " "));

if (false) {} else {}

process.exit(0);
