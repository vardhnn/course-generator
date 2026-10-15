import { afterEach, describe, expect, it, vi } from "vitest";
import { researchTopic } from "@/lib/research";

afterEach(() => {
  delete process.env.EXA_API_KEY;
  vi.unstubAllGlobals();
});

function stubFetch(payload: unknown, ok = true, status = 200) {
  const spy = vi.fn(async () => ({
    ok,
    status,
    text: async () => (ok ? JSON.stringify(payload) : "upstream exploded"),
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("researchTopic", () => {
  it("returns no sources and stays local when no key is configured", async () => {
    delete process.env.EXA_API_KEY;
    const r = await researchTopic("Consensus", "advanced");
    expect(r.live).toBe(false);
    expect(r.sources).toEqual([]);
  });

  it("maps Exa results into scored sources", async () => {
    process.env.EXA_API_KEY = "exa-test";
    stubFetch({
      results: [
        {
          title: "Consensus primer",
          url: "https://docs.example.io/consensus",
          text: "A".repeat(2000),
          highlights: ["one", "two", "three"],
        },
        {
          title: "Blog post",
          url: "https://medium.com/@someone/consensus",
          text: "short",
        },
      ],
    });

    const r = await researchTopic("Consensus", "advanced");
    expect(r.live).toBe(true);
    expect(r.sources).toHaveLength(2);

    const [docs, blog] = r.sources;
    expect(docs.publisher).toBe("docs.example.io");
    expect(docs.reliability).toBeGreaterThan(blog.reliability);
    expect(docs.reliability).toBeLessThanOrEqual(99);
    expect(blog.reliability).toBeGreaterThan(0);
  });

  it("keeps reliability within 0-100 for every source", async () => {
    process.env.EXA_API_KEY = "exa-test";
    stubFetch({
      results: Array.from({ length: 8 }, (_, i) => ({
        title: `t${i}`,
        url: `https://x${i}.example.com/a`,
        text: "y".repeat(900 * i),
        highlights: new Array(i).fill("h"),
      })),
    });
    const r = await researchTopic("Topic", "beginner");
    expect(r.sources.length).toBe(8);
    for (const s of r.sources) {
      expect(s.reliability).toBeGreaterThanOrEqual(0);
      expect(s.reliability).toBeLessThanOrEqual(100);
    }
  });

  it("drops entries without a url", async () => {
    process.env.EXA_API_KEY = "exa-test";
    stubFetch({ results: [{ title: "no url" }, { title: "ok", url: "https://a.example/b" }] });
    const r = await researchTopic("Topic", "beginner");
    expect(r.sources).toHaveLength(1);
  });

  it("degrades to local sources when Exa returns an error", async () => {
    process.env.EXA_API_KEY = "exa-test";
    stubFetch({}, false, 401);
    const r = await researchTopic("Topic", "beginner");
    expect(r.live).toBe(false);
    expect(r.sources).toEqual([]);
    expect(r.detail).toContain("401");
  });

  it("degrades when the network throws", async () => {
    process.env.EXA_API_KEY = "exa-test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const r = await researchTopic("Topic", "beginner");
    expect(r.live).toBe(false);
    expect(r.sources).toEqual([]);
  });

  it("survives an empty result set", async () => {
    process.env.EXA_API_KEY = "exa-test";
    stubFetch({ results: [] });
    const r = await researchTopic("Topic", "beginner");
    expect(r.live).toBe(true);
    expect(r.sources).toEqual([]);
  });
});