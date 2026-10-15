import { describe, expect, it } from "vitest";
import { buildBlueprint } from "@/lib/ai/blueprint";

describe("buildBlueprint — determinism", () => {
  it("returns identical output for the same topic and level", () => {
    const a = buildBlueprint("Distributed consensus", "advanced");
    const b = buildBlueprint("Distributed consensus", "advanced");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("returns different output for different topics", () => {
    const a = buildBlueprint("Type theory", "beginner");
    const b = buildBlueprint("Shader programming", "beginner");
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe("buildBlueprint — structure", () => {
  const bp = buildBlueprint("Distributed consensus", "intermediate", "to debug clusters");

  it("produces modules with ordered lessons", () => {
    expect(bp.modules.length).toBeGreaterThanOrEqual(4);
    for (const m of bp.modules) {
      expect(m.lessons.length).toBeGreaterThan(0);
    }
  });

  it("gives playground lessons runnable starter and solution code", () => {
    const playgrounds = bp.modules.flatMap((m) => m.lessons).filter((l) => l.kind === "playground");
    expect(playgrounds.length).toBeGreaterThan(0);
    for (const l of playgrounds) {
      expect(l.codeStarter).toBeTruthy();
      expect(l.codeSolution).toBeTruthy();
    }
  });

  it("gives reading lessons markdown content and no code", () => {
    const readings = bp.modules.flatMap((m) => m.lessons).filter((l) => l.kind === "reading");
    expect(readings.length).toBeGreaterThan(0);
    for (const l of readings) {
      expect(l.contentMd).toContain("##");
      expect(l.codeStarter).toBeUndefined();
    }
  });

  it("includes all four question kinds", () => {
    const kinds = new Set(bp.questions.map((q) => q.kind));
    expect(kinds).toContain("mcq");
    expect(kinds).toContain("truefalse");
    expect(kinds).toContain("shortanswer");
    expect(kinds).toContain("code");
  });

  it("gives mcq and true/false questions at least two options", () => {
    for (const q of bp.questions) {
      if (q.kind === "mcq" || q.kind === "truefalse") {
        expect(q.options.length).toBeGreaterThanOrEqual(2);
        expect(q.options).toContain(q.answer);
      }
    }
  });

  it("scores sources within a sane range and sorts nothing itself", () => {
    expect(bp.sources.length).toBeGreaterThan(0);
    for (const s of bp.sources) {
      expect(s.reliability).toBeGreaterThanOrEqual(0);
      expect(s.reliability).toBeLessThanOrEqual(100);
      expect(s.url).toMatch(/^https?:\/\//);
    }
  });

  it("keeps prerequisite status inside the allowed set", () => {
    for (const p of bp.prerequisites) {
      expect(["missing", "covered", "teaching"]).toContain(p.status);
    }
  });

  it("totals a positive estimated duration", () => {
    expect(bp.estMinutes).toBeGreaterThan(0);
  });
});

describe("buildBlueprint — level sensitivity", () => {
  it("adds an internals module only at the advanced level", () => {
    const advanced = buildBlueprint("Consensus", "advanced");
    const intermediate = buildBlueprint("Consensus", "intermediate");
    expect(advanced.modules.length).toBe(intermediate.modules.length + 1);
    expect(advanced.modules.some((m) => /internals/i.test(m.title))).toBe(true);
  });

  it("uses a correct indefinite article for vowel-initial levels", () => {
    expect(buildBlueprint("Type theory", "advanced").summary).toMatch(/^An advanced/);
    expect(buildBlueprint("Type theory", "intermediate").summary).toMatch(/^An intermediate/);
    expect(buildBlueprint("Type theory", "beginner").summary).toMatch(/^A beginner/);
  });

  it("marks prerequisites as taught rather than missing for beginners", () => {
    const beginner = buildBlueprint("Consensus", "beginner");
    const advanced = buildBlueprint("Consensus", "advanced");
    const teaching = beginner.prerequisites.filter((p) => p.status === "teaching").length;
    const advancedTeaching = advanced.prerequisites.filter((p) => p.status === "teaching").length;
    expect(teaching).toBeGreaterThan(advancedTeaching);
  });

  it("mentions the learner goal in the summary when one is given", () => {
    expect(buildBlueprint("Consensus", "beginner", "to run a cluster").summary).toContain(
      "to run a cluster",
    );
  });
});