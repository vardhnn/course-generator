import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const log = (m) => appendFileSync("probe4.log", `${new Date().toISOString()} ${m}\n`);
const start = Date.now();
log("probe4 start");

const dev = spawn("npx", ["npm", "run", "dev"], {
  stdio: ["ignore", "pipe", "pipe"],
  shell: true,
});

let readyLine = null;
let nextPort = null;
const stdout = [];
dev.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  stdout.push(text);
  if (/Ready in/.test(text)) readyLine = text;
  const m = text.match(/Local:\s+http:\/\/localhost:(\d+)/);
  if (m) nextPort = m[1];
});
dev.stderr.on("data", (chunk) => {
  stdout.push("STDERR> " + chunk.toString());
});

const checkRoutes = (port, base) => {
  log("checking routes on %s", port);
  const fetches = [
    ["/", "home"],
    ["/library", "library"],
    ["/login", "login"],
    ["/course/does-not-exist", "missing"],
    ["/dashboard", "dashboard"],
    ["/generate", "generate"],
    ["/progress", "progress"],
    ["/certificates", "certificates"],
    ["/settings", "settings"],
  ];
  const results = Promise.all(
    fetches.map(async ([path, label]) => {
      try {
        const res = await fetch(base + path, { redirect: "manual" });
        log("%s=%d", label, res.status);
      } catch (e) {
        log("%s=ERR %s", label, e?.message ?? e);
      }
    })
  );
  return results;
};

// Give the server up to 90s to print "Ready in".
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
  log("port=%s", nextPort);
  await checkRoutes(nextPort, "http://localhost:" + nextPort);
} catch (err) {
  log("FAILED: %s", err.message);
} finally {
  dev.kill("SIGTERM");
  log("stopped dev process");
}

log("elapsed=%sms", Date.now() - start);
process.exit(0);
