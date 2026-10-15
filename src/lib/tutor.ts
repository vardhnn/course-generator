import { prisma } from "@/lib/prisma";
import { providerFromResolved, resolveProviderForRequest } from "@/lib/ai/resolve";

export type Retrieved = { lessonId: string; lessonTitle: string; moduleTitle: string; excerpt: string };

const STOP = new Set([
  "the","a","an","is","are","was","were","it","its","this","that","to","of","in","on","for",
  "and","or","but","be","been","has","have","had","not","no","you","your","if","because","so",
  "as","by","with","from","at","than","then","there","their","they","what","when","where","how",
  "do","does","did","can","could","would","should","about","me","my","i","we","us","help","explain",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Split lesson markdown into paragraphs we can quote as grounded evidence. */
function paragraphs(contentMd: string): string[] {
  return contentMd
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 60 && !p.startsWith("```") && !p.startsWith("#"));
}

export async function retrieve(courseId: string, question: string, limit = 3): Promise<Retrieved[]> {
  const lessons = await prisma.lesson.findMany({
    where: { module: { courseId } },
    include: { module: true },
  });

  const q = new Set(tokens(question));
  const scored = lessons.flatMap((lesson) => {
    const paras = paragraphs(lesson.contentMd);
    if (paras.length === 0) return [];
    let best: { excerpt: string; score: number } | null = null;
    for (const excerpt of paras) {
      const words = tokens(excerpt);
      if (words.length === 0) continue;
      const overlap = words.filter((w) => q.has(w)).length;
      const score = overlap / Math.sqrt(words.length);
      if (!best || score > best.score) best = { excerpt, score };
    }
    if (!best || best.score <= 0) return [];
    return [
      {
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        moduleTitle: lesson.module.title,
        excerpt: best.excerpt,
        score: best.score,
      },
    ];
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ lessonId, lessonTitle, moduleTitle, excerpt }) => ({
      lessonId,
      lessonTitle,
      moduleTitle,
      excerpt: excerpt.length > 460 ? `${excerpt.slice(0, 460)}…` : excerpt,
    }));
}

function localAnswer(question: string, hits: Retrieved[]): string {
  if (hits.length === 0) {
    return `I could not find anything in this course that covers that.\n\nThis tutor is grounded on the enrolled lessons only — it will not reach outside the course. Try asking about a concept, a stage of the pipeline, or an edge case named in the material.`;
  }
  const lines = hits.map(
    (h, i) => `**${i + 1}. ${h.lessonTitle}** (${h.moduleTitle})\n\n${h.excerpt}`,
  );
  return `Based only on this course:\n\n${lines.join("\n\n")}\n\nIf none of that answers it, re-read the lesson above — the tutor will not speculate beyond the enrolled material.`;
}

const SYSTEM = `You are a patient course tutor. Answer ONLY from the supplied lesson excerpts.
If the excerpts do not contain the answer, say so plainly and point to the lesson closest to it.
Never use outside knowledge. Be concise: three short paragraphs at most. Cite lessons like [Lesson title].`;

export async function tutorAnswer(
  courseId: string,
  question: string,
  request?: Request,
): Promise<{ answer: string; citations: Retrieved[]; live: boolean }> {
  const citations = await retrieve(courseId, question);

  if (citations.length === 0) {
    return { answer: localAnswer(question, citations), citations, live: false };
  }

  const context = citations
    .map((c) => `### ${c.lessonTitle} (${c.moduleTitle})\n${c.excerpt}`)
    .join("\n\n");

  // Course text answers first when no provider is live — never blocked on AI.
  const resolved = await resolveProviderForRequest(request);
  const provider = providerFromResolved(resolved);

  if (!provider) {
    return { answer: localAnswer(question, citations), citations, live: false };
  }

  try {
    const raw = await provider.generate({
      system: SYSTEM,
      prompt: `Lesson excerpts from the enrolled course:\n\n${context}\n\nStudent question: ${question}`,
      maxTokens: 900,
    });
    return { answer: raw.trim(), citations, live: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[tutor] provider failed, answering locally: ${detail}`);
    return {
      answer: `${localAnswer(question, citations)}\n\n_(The live model was unreachable — this answer was assembled from the course text instead.)_`,
      citations,
      live: false,
    };
  }
}