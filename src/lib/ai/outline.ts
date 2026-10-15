import type { AIProvider } from "@/lib/ai/provider";
import { extractJson } from "@/lib/ai/provider";
import type { Blueprint, BlueprintLesson, BlueprintQuestion } from "./blueprint";
import type { AttachmentBrief, Brief } from "@/lib/validation";

/**
 * Attachments are the highest-signal input the learner can give, but
 * pasting every byte into every request would blow the per-module
 * budget. The outline pass gets a generous digest; each module pass
 * gets just the names and a flavour of the content, so lessons still
 * echo the materials without re-sending them in full.
 */
const OUTLINE_DIGEST_CHARS = 8_000;
const OUTLINE_TOTAL_CHARS = 24_000;
const MODULE_SNIPPET_CHARS = 400;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

/** Full digest for curriculum design — names, kinds and real content. */
export function attachmentDigest(attachments: AttachmentBrief[]): string {
  if (attachments.length === 0) return "";
  const parts: string[] = [];
  let budget = OUTLINE_TOTAL_CHARS;
  for (const a of attachments) {
    if (budget <= 0) break;
    const slice = clip(a.text, Math.min(OUTLINE_DIGEST_CHARS, budget));
    parts.push(`- ${a.name} (${a.kind}):\n  ${slice}`);
    budget -= slice.length;
  }
  const truncated = attachments.some((a) => a.text.length > OUTLINE_DIGEST_CHARS);
  return `\nThe learner attached ${attachments.length} file(s) of context. The course MUST cover the topics, terms and skills named in them, at the depth they imply.${truncated ? " (Long files were truncated; the themes still stand.)" : ""}\n${parts.join("\n")}\n`;
}

/** Compact reminder for the per-module writing pass. */
function attachmentFlavour(attachments: AttachmentBrief[]): string {
  if (attachments.length === 0) return "";
  const lines = attachments
    .map((a) => `- ${a.name} (${a.kind}): ${clip(a.text, MODULE_SNIPPET_CHARS)}`)
    .join("\n");
  return `\nThe course was designed around these attached materials — ground examples, vocabulary and assessment items in them wherever the module touches them:\n${lines}\n`;
}

/**
 * Asking for the whole course — every module, every lesson's prose, the code
 * samples and every question — in a single JSON response produced a payload
 * large enough that hosted endpoints regularly ran past the 120s timeout. The
 * request then burned its whole budget, retried, and fell back to the local
 * generator: slow *and* lower quality.
 *
 * Splitting it has three effects, all of them wanted:
 *   - each request is small enough to land in seconds, so the retry budget is
 *     spent on real problems rather than on size;
 *   - the outline lands first, so the UI shows genuine progress within a
 *     second instead of appearing frozen on "draft the curriculum";
 *   - per-module content calls are independent, so they can overlap.
 */

const OUTLINE_SYSTEM = `You are a senior curriculum engineer. You design short, dense technical courses.
Reply with a single JSON object and nothing else. No prose, no markdown fences.

Schema:
{
  "summary": string,
  "estMinutes": number,
  "modules": [{ "title": string, "summary": string, "lessons": [
    { "title": string, "kind": "reading" | "playground", "summary": string, "estMinutes": number }
  ]}],
  "sources": [{ "title": string, "url": string, "publisher": string, "reliability": number, "snippet": string }],
  "prerequisites": [{ "title": string, "reason": string, "status": "missing" | "covered" | "teaching" }]
}

Rules: plan 4-5 modules with 2-3 lessons each. Lessons are outlines only —
do NOT write lesson prose here, that happens in a later pass.
Reuse the supplied source URLs verbatim.`;

const CONTENT_SYSTEM = `You are a senior technical writer. Reply with a single JSON object and nothing else.

Schema:
{ "lessons": [{ "title": string, "contentMd": string, "codeStarter"?: string, "codeSolution"?: string }],
  "questions": [{ "kind": "mcq" | "truefalse" | "shortanswer" | "code", "prompt": string,
    "options": string[], "answer": string, "explanation": string,
    "difficulty": "core" | "stretch", "points": number }] }

Rules: write each lesson's contentMd as 3-4 paragraphs of markdown.
Wrap diagrams in fenced code blocks tagged "text". Never use fenced blocks for prose.
For a "playground" lesson include runnable JavaScript codeStarter and codeSolution.`;

function levelNote(brief: Brief) {
  if (brief.level === "advanced") {
    return "Assume fluency. Include one module on internals beneath the abstraction.";
  }
  if (brief.level === "beginner") {
    return "Start from first principles. Teach the vocabulary before using it.";
  }
  return "Assume the fundamentals. Emphasise tradeoffs and edge cases.";
}

function grounding(research: Blueprint["sources"]) {
  if (!research.length) return "";
  return `\nWeb research found these sources. Ground the course in them and reuse their URLs in "sources":\n${research
    .map((s) => `- ${s.title} (${s.publisher}, reliability ${s.reliability}) ${s.url}\n  ${s.snippet}`)
    .join("\n")}\n`;
}

/**
 * Keywords lifted from the attached files, for the research query.
 * Filenames alone are weak signal ("notes v2.txt"), so headings and
 * repeated capitalized terms carry the weight.
 */
export function attachmentKeywords(attachments: AttachmentBrief[]): string {
  if (attachments.length === 0) return "";
  const words = new Set<string>();
  for (const a of attachments) {
    for (const m of a.name.match(/[A-Za-z][A-Za-z0-9+#.()-]{2,}/g) ?? []) {
      words.add(m);
    }
    // Heading-like lines are the topics the author considered important.
    for (const line of a.text.split("\n")) {
      const t = line.trim();
      if (/^(#{1,6}\s|\d+\.\s|[A-Z][A-Za-z0-9 ,&-]{6,}:?$)/.test(t)) {
        words.add(t.replace(/^#+\s*/, "").replace(/[:.]$/, "").slice(0, 40));
      }
      if (words.size >= 24) break;
    }
    if (words.size >= 24) break;
  }
  return [...words].slice(0, 24).join(" ");
}

function parse(raw: string): unknown {
  return JSON.parse(extractJson(raw));
}

/**
 * Gemini's free tier allows ~20 generate_content requests per minute. Firing
 * every module at once is exactly the burst shape that trips that limit, so
 * the content pass is capped and the calls are spaced out.
 */
const MAX_CONCURRENT = 3;
const MIN_GAP_MS = 400;

let chain: Promise<unknown> = Promise.resolve();

/** Run tasks with bounded concurrency and a small gap between starts. */
async function withRateLimit<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++;
      // Space out starts even when a slot frees immediately.
      const wait = chain.then(() => sleep(MIN_GAP_MS));
      chain = wait.catch(() => undefined);
      await wait;
      results[i] = await tasks[i]();
    }
  };

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, tasks.length) }, worker));
  return results;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface OutlineShape {
  summary: string;
  estMinutes: number;
  modules: Array<{
    title: string;
    summary: string;
    lessons: Array<{ title: string; kind: string; summary: string; estMinutes: number }>;
  }>;
  sources: Blueprint["sources"];
  prerequisites: Blueprint["prerequisites"];
}

/** Phase 1 — small, fast: the shape of the course with no prose. */
export async function buildOutline(
  provider: AIProvider,
  brief: Brief,
  research: Blueprint["sources"],
): Promise<OutlineShape> {
  const prompt = `Plan a course.

Topic: ${brief.topic}
Level: ${brief.level}
${grounding(research)}${attachmentDigest(brief.attachments)}${levelNote(brief)}
${brief.goal ? `Learner goal: ${brief.goal}\n` : ""}
Produce 4-5 modules with 2-3 lessons each, 5 sources and 3-4 prerequisites. When attachments exist, at least one lesson must be explicitly about the attached material.`;

  const raw = await provider.generate({
    system: OUTLINE_SYSTEM,
    prompt,
    json: true,
    // Reasoning models spend their own thinking tokens out of this same
    // budget, so a cap that looks generous for the JSON alone is not.
    maxTokens: 16_000,
  });
  const parsed = parse(raw) as OutlineShape;
  if (!parsed?.modules?.length) throw new Error("Outline had no modules.");
  return parsed;
}

/** Phase 2 — the prose, one module at a time so requests stay small. */
export async function buildModuleContent(
  provider: AIProvider,
  brief: Brief,
  module: OutlineShape["modules"][number],
  shareQuestions: number,
): Promise<{ lessons: BlueprintLesson[]; questions: BlueprintQuestion[] }> {
  const plan = module.lessons
    .map((l) => `- ${l.title} (${l.kind}, ~${l.estMinutes}m): ${l.summary ?? ""}`)
    .join("\n");

  const raw = await provider.generate({
    system: CONTENT_SYSTEM,
    prompt: `Write these lessons for a ${brief.level} course on "${brief.topic}".

Module: ${module.title}
${brief.goal ? `Learner goal: ${brief.goal}` : ""}${attachmentFlavour(brief.attachments)}

Lessons to write:
${plan}

Write ${shareQuestions} question(s) about this module, spread across the four kinds. When the module touches the attached materials, ask about their content directly.`,
    json: true,
    maxTokens: 16_000,
  });

  const parsed = parse(raw) as {
    lessons?: Array<Partial<BlueprintLesson>>;
    questions?: BlueprintQuestion[];
  };

  const lessons: BlueprintLesson[] = module.lessons.map((planned) => {
    const written = (parsed.lessons ?? []).find(
      (l) => (l.title ?? "").toLowerCase() === planned.title.toLowerCase(),
    );
    return {
      title: written?.title ?? planned.title,
      kind: planned.kind === "playground" ? "playground" : "reading",
      summary: planned.summary ?? "",
      contentMd: written?.contentMd ?? "",
      codeStarter: written?.codeStarter,
      codeSolution: written?.codeSolution,
      estMinutes: planned.estMinutes ?? 8,
    };
  });

  return { lessons, questions: parsed.questions ?? [] };
}

/**
 * Run the content pass across every module. Independent modules overlap, so
 * wall-clock is roughly the slowest module rather than the sum of all of them.
 */
export async function buildCourse(
  provider: AIProvider,
  brief: Brief,
  research: Blueprint["sources"],
  onProgress?: (message: string, progress: number) => void,
): Promise<Blueprint> {
  onProgress?.("Designing the module outline…", 20);
  const outline = await buildOutline(provider, brief, research);

  const totalQuestions = 6;
  const perModule = Math.max(1, Math.round(totalQuestions / outline.modules.length));

  onProgress?.(`Outline ready — writing ${outline.modules.length} modules…`, 30);

  // Progress is reported per completed module, so a slow local model shows
  // movement inside what would otherwise be one silent multi-minute call.
  let written = 0;
  const filled = await withRateLimit(
    outline.modules.map((m) => async () => {
      const result = await buildModuleContent(provider, brief, m, perModule);
      written += 1;
      onProgress?.(
        `Writing module ${written} of ${outline.modules.length}: ${m.title}`,
        Math.round(30 + (65 * written) / outline.modules.length),
      );
      return result;
    }),
  );

  onProgress?.("Assembling the blueprint…", 97);

  const questions = filled
    .flatMap((f, i) => f.questions.map((q) => ({ ...q, moduleTitle: outline.modules[i].title })))
    .slice(0, totalQuestions);

  return {
    summary: outline.summary,
    estMinutes: outline.estMinutes,
    coverStyle: "grid",
    modules: outline.modules.map((m, i) => ({
      title: m.title,
      summary: m.summary ?? "",
      lessons: filled[i].lessons,
    })),
    sources: outline.sources ?? [],
    prerequisites: outline.prerequisites ?? [],
    questions,
  };
}