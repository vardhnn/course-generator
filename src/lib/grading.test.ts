import { describe, expect, it } from "vitest";
import { grade } from "@/lib/grading";

describe("grade — multiple choice and true/false", () => {
  const mcq = {
    kind: "mcq" as const,
    answer: "The first stage that touches the value",
    options: ["A", "B"],
    points: 1,
  };

  it("awards full points for the exact answer", () => {
    const r = grade({ ...mcq, response: "The first stage that touches the value" });
    expect(r.correct).toBe(true);
    expect(r.score).toBe(1);
  });

  it("is insensitive to case, punctuation and spacing", () => {
    const r = grade({ ...mcq, response: "  the FIRST stage, that touches the value! " });
    expect(r.correct).toBe(true);
  });

  it("rejects a wrong answer and reveals the expected one", () => {
    const r = grade({ ...mcq, response: "Whichever is easiest" });
    expect(r.correct).toBe(false);
    expect(r.score).toBe(0);
    expect(r.feedback).toContain("The first stage that touches the value");
  });

  it("grades true/false by normalised text", () => {
    const base = { kind: "truefalse" as const, answer: "True", options: ["True", "False"], points: 1 };
    expect(grade({ ...base, response: "true" }).correct).toBe(true);
    expect(grade({ ...base, response: "False" }).correct).toBe(false);
  });
});

describe("grade — short answer", () => {
  const base = {
    kind: "shortanswer" as const,
    options: [],
    points: 2,
    answer:
      "Silent corruption. It is more dangerous because nothing raises an alarm: the error surfaces far downstream.",
  };

  it("accepts an answer covering the key ideas", () => {
    const r = grade({ ...base, response: "Silent corruption, and it is worse because nothing raises an alarm" });
    expect(r.correct).toBe(true);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(2);
  });

  it("gives partial credit when only some keywords appear", () => {
    const r = grade({ ...base, response: "it is a silent corruption problem" });
    expect(r.correct).toBe(false);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(2);
  });

  it("scores an unrelated answer at zero and points at what is missing", () => {
    const r = grade({ ...base, response: "bananas" });
    expect(r.score).toBe(0);
    expect(r.feedback).toContain("Model answer");
  });
});

describe("grade — code", () => {
  const solution = `
    function validate(values) {
      const bad = values.findIndex((n) => !Number.isFinite(n));
      if (bad !== -1) {
        throw new Error("validate: value at index is not finite");
      }
      return values;
    }
  `;
  const base = { kind: "code" as const, options: [], points: 3, answer: solution };

  it("accepts a near-identical solution", () => {
    const r = grade({ ...base, response: solution });
    expect(r.correct).toBe(true);
    expect(r.score).toBe(3);
  });

  it("ignores comments so a commented answer still passes", () => {
    const r = grade({ ...base, response: `// my fix\n${solution}` });
    expect(r.correct).toBe(true);
  });

  it("rejects unrelated code and names what is missing", () => {
    const r = grade({ ...base, response: "function add(a, b) { return a + b; }" });
    expect(r.correct).toBe(false);
    expect(r.score).toBeLessThan(3);
    expect(r.feedback).toContain("Missing");
  });
});
