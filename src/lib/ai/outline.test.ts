import { describe, expect, it } from "vitest";
import { buildCourse } from "./outline";
import type { AIProvider, GenerateOpts } from "./provider";

const OUTLINE = JSON.stringify({
  summary: "A beginner course about progress reporting.",
  estMinutes: 42,
  modules: [
    {
      title: "Module one",
      summary: "s1",
      lessons: [{ title: "L1", kind: "reading", summary: "", estMinutes: 10 }],
    },
    {
      title: "Module two",
      summary: "s2",
      lessons: [{ title: "L2", kind: "reading", summary: "", estMinutes: 10 }],
    },
  ],
  sources: [],
  prerequisites: [],
});

const CONTENT = JSON.stringify({ lessons: [], questions: [] });

/** Echoes canned JSON so buildCourse can run without a real model. */
function stubProvider(): AIProvider {
  const generate = (opts: GenerateOpts) =>
    Promise.resolve(opts.prompt.includes("Plan a course") ? OUTLINE : CONTENT);
  return {
    name: "mock",
    live: true,
    generate,
    async *stream(opts) {
      yield await generate(opts);
    },
  };
}

describe("buildCourse progress reporting", () => {
  it("reports outline, per-module and assembly progress", async () => {
    const messages: string[] = [];
    const blueprint = await buildCourse(
      stubProvider(),
      { topic: "Progress", level: "beginner", goal: "", attachments: [] },
      [],
      (message) => messages.push(message),
    );

    expect(blueprint.modules).toHaveLength(2);
    expect(messages[0]).toMatch(/outline/i);
    expect(messages.some((m) => /module 1 of 2/.test(m))).toBe(true);
    expect(messages.some((m) => /module 2 of 2/.test(m))).toBe(true);
    expect(messages.at(-1)).toMatch(/assembling/i);
  }, 20_000);

  it("works without a progress listener", async () => {
    const blueprint = await buildCourse(
      stubProvider(),
      { topic: "Quiet", level: "beginner", goal: "", attachments: [] },
      [],
    );
    expect(blueprint.modules).toHaveLength(2);
  }, 20_000);
});
