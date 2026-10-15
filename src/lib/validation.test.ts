import { describe, expect, it } from "vitest";
import { BriefSchema, formatMinutes, hashString, safeNextPath, slugify } from "@/lib/validation";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Distributed Consensus")).toBe("distributed-consensus");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugify("Type theory  &  generics!!")).toBe("type-theory-generics");
  });

  it("removes accents via NFKD normalisation", () => {
    expect(slugify("Réseaux neuronaux")).toBe("reseaux-neuronaux");
  });

  it("caps length and never ends in a hyphen", () => {
    const s = slugify("a".repeat(80));
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });

  it("returns an empty string for punctuation-only input", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("hashString", () => {
  it("is deterministic and non-negative", () => {
    const a = hashString("consensus");
    expect(a).toBe(hashString("consensus"));
    expect(a).toBeGreaterThanOrEqual(0);
  });

  it("separates different inputs", () => {
    expect(hashString("consensus")).not.toBe(hashString("consensu"));
  });
});

describe("formatMinutes", () => {
  it("handles the degenerate cases", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
  });

  it("drops a zero minute component", () => {
    expect(formatMinutes(120)).toBe("2h");
  });

  it("combines hours and minutes", () => {
    expect(formatMinutes(154)).toBe("2h 34m");
  });
});

describe("BriefSchema", () => {
  it("accepts a valid brief and defaults the goal", () => {
    const b = BriefSchema.parse({ topic: "Shader programming", level: "intermediate" });
    expect(b.goal).toBe("");
  });

  it("rejects a topic that is too short", () => {
    expect(() => BriefSchema.parse({ topic: "ab", level: "beginner" })).toThrow();
  });

  it("rejects an unknown level", () => {
    expect(() => BriefSchema.parse({ topic: "Type theory", level: "expert" })).toThrow();
  });

  it("trims whitespace from the topic", () => {
    expect(BriefSchema.parse({ topic: "  Type theory  ", level: "beginner" }).topic).toBe(
      "Type theory",
    );
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin paths, query strings included", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/course/typescript/lesson/abc?tab=code")).toBe(
      "/course/typescript/lesson/abc?tab=code",
    );
  });

  it("falls back when no next is supplied", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined, "/login")).toBe("/login");
    expect(safeNextPath("")).toBe("/dashboard");
  });

  it("rejects absolute and protocol-relative targets", () => {
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
  });
});