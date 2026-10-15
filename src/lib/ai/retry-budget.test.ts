import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/lib/ai/provider";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

// Resolved from the project root, which is where Vitest runs and where the
// `file:./test.db` Prisma URL lands (relative to prisma/schema.prisma).
const DB_FILE = path.resolve(process.cwd(), "prisma/test.db");

beforeAll(async () => {
  rmSync(DB_FILE, { force: true });
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "ignore",
    // `npx` is a shell shim on Windows and cannot be spawned directly.
    shell: true,
  });
}, 120_000);

afterAll(async () => {
  const { prisma } = await import("@/lib/prisma");
  await prisma.$disconnect();
  rmSync(DB_FILE, { force: true });
});

// resolveBlueprint is not exported, so exercise it through the pipeline's own
// dependency seam: drive generateCourse with a stubbed provider module.
const state = vi.hoisted(() => ({
  live: true,
  calls: 0,
  impl: async () => "{}",
}));

vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/provider")>();
  return {
    ...actual,
    resolveProvider: () => ({
      name: "openai" as const,
      live: state.live,
      detail: "stub/model",
    }),
    createProvider: (config?: Parameters<typeof actual.createProvider>[0]) => ({
      generate: () => {
        state.calls++;
        return state.impl();
      },
      stream: () => state.impl(),
    }),
  };
});

vi.mock("@/lib/research", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/research")>();
  return {
    ...actual,
    researchTopic: async () => ({ sources: [], degraded: true, reason: "stubbed" }),
  };
});

async function generate() {
  const { generateCourse } = await import("@/lib/ai/pipeline");
  return generateCourse(
    {
      topic: "Retry budgets",
      level: "advanced",
      goal: "to bound upstream latency",
      attachments: [],
    },
    () => {},
  );
}

beforeEach(() => {
  state.live = true;
  state.calls = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("resolveBlueprint retry budget", () => {
  it("does not retry a retryable upstream failure a second time", async () => {
    // The provider layer has already burned its own attempt budget; stacking a
    // second one here would push a single generation past the route timeout.
    state.impl = async () => {
      throw new ProviderError("upstream overloaded", undefined, true);
    };

    const result = await generate();

    expect(state.calls).toBe(1);
    expect(result.source).toBe("local");
  });

  it("does retry a malformed JSON contract failure once", async () => {
    // A model that answers but ignores the schema can succeed on a retry.
    state.impl = async () => {
      if (state.calls === 1) return "{ not json";
      return JSON.stringify({
        summary: "Retry budgets",
        estMinutes: 30,
        modules: [
          {
            title: "Bounding latency",
            summary: "s",
            lessons: [
              { title: "Budgets", kind: "reading", summary: "s", contentMd: "c", estMinutes: 5 },
            ],
          },
        ],
        sources: [],
        prerequisites: [],
        questions: [],
      });
    };

    const result = await generate();

    // Three calls: the malformed outline (1), the retried outline that
    // succeeds (2), then the single per-module content call (3). The point of
    // the test is that a contract failure is retried rather than abandoned,
    // and that the run ends on the live provider instead of "local".
    expect(state.calls).toBe(3);
    expect(result.source).toBe("openai:stub/model");
  });

  it("gives up after two contract failures and falls back", async () => {
    state.impl = async () => "{ not json";

    const result = await generate();

    expect(state.calls).toBe(2);
    expect(result.source).toBe("local");
  });
});