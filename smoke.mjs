import { spawnSync } from "node:child_process";

const BASE_URL =
  process.env.BASE_URL?.replace(/\/$/, "") ??
  `http://localhost:${process.env.DEV_PORT ?? "63699"}`;

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

const passed = checks
  .map(([path, label]) => {
    const code = spawnSync(
      "curl",
      ["-s", "-o", "nul", "-w", "%{http_code}", `${BASE_URL}${path}`],
    ).stdout.toString().trim();
    return { label, code: Number(code) };
  })
  .filter((c) => c.code >= 200 && c.code < 500);

console.log(
  `smoke: ${passed.length}/${checks.length} pages up — ` +
    passed.map((p) => `${p.label}=${p.code}`).join(", "),
);
process.exit(passed.length === checks.length ? 0 : 1);
