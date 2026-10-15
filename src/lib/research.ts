import type { BlueprintSource } from "@/lib/ai/blueprint";
import type { Level } from "@/lib/validation";

const EXA_ENDPOINT = "https://api.exa.ai/search";

export interface ResearchResult {
  sources: BlueprintSource[];
  live: boolean;
  detail: string;
}

/** Rough domain prior: how much a publisher is trusted for technical claims. */
const PUBLISHER_TRUST: Array<[RegExp, number]> = [
  [/\.(gov|edu)\b|\.edu\./i, 78],
  [/(^|\.)wikipedia\.org$/i, 55],
  [/docs?\.|developer|reference|spec|stdlib|manual/i, 74],
  [/blog|medium|substack|dev\.to|hashnode/i, 58],
  [/(youtube|tiktok|reddit|quora|pinterest)/i, 32],
  [/\.(com|org|net|io|dev|ai)\b/i, 50],
];

/**
 * A transparent scoring function: the model is asked how well a source
 * supports the claim, and the publisher prior adjusts it. No black box.
 */
function scoreSource(contentLength: number, highlights: number, url: string, publisher: string): number {
  const haystack = `${url} ${publisher}`;
  let prior = 50;
  for (const [pattern, value] of PUBLISHER_TRUST) {
    if (pattern.test(haystack)) {
      prior = value;
      break;
    }
  }
  const depth = Math.min(18, contentLength / 400);
  const evidence = Math.min(8, highlights * 4);
  return Math.max(5, Math.min(99, Math.round(prior + depth + evidence)));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

function clampText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function researchTopic(
  topic: string,
  level: Level,
  goal = "",
  extraKeywords = "",
): Promise<ResearchResult> {
  const key = process.env.EXA_API_KEY?.trim();

  if (!key) {
    return { sources: [], live: false, detail: "no EXA_API_KEY configured" };
  }

  // Keywords lifted from attached files steer the search toward the
  // vocabulary the learner actually needs, not just the topic name.
  const query = `${topic} ${level === "beginner" ? "introduction fundamentals tutorial" : level === "advanced" ? "internals advanced deep dive" : "guide best practices"}${goal ? ` ${goal}` : ""}${extraKeywords ? ` ${extraKeywords}` : ""}`.slice(0, 500);

  try {
    const res = await fetch(EXA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({
        query,
        numResults: 6,
        type: "auto",
        contents: { text: { maxCharacters: 2200, includeHtmlTags: false }, highlights: { numSentences: 3 } },
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[research] Exa request failed (${res.status}).`, detail.slice(0, 300));
      return { sources: [], live: false, detail: `exa ${res.status}` };
    }

    const data = (await res.json()) as {
      results?: Array<{
        title?: string | null;
        url?: string;
        text?: string | null;
        highlights?: string[] | null;
        author?: string | null;
        publishedDate?: string | null;
      }>;
    };

    const sources: BlueprintSource[] = (data.results ?? [])
      .filter((r) => r.url)
      .map((r) => {
        const url = r.url as string;
        const publisher = hostOf(url);
        const body = r.text ?? r.highlights?.join(" ") ?? "";
        return {
          title: clampText(r.title ?? publisher, 90),
          url,
          publisher,
          reliability: scoreSource(body.length, r.highlights?.length ?? 0, url, r.author ?? publisher),
          snippet: clampText(body, 320) || "No extractable text on this page.",
        };
      });

    return { sources, live: true, detail: `exa:${sources.length}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[research] Exa unreachable: ${detail}`);
    return { sources: [], live: false, detail };
  }
}
