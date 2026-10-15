import { prisma } from "@/lib/prisma";
import { sessionTokenFromRequest, userFromToken } from "@/lib/auth";
import { buildBlueprint, type Blueprint, type BlueprintSource } from "@/lib/ai/blueprint";
import { ProviderError } from "@/lib/ai/provider";
import { buildCourse } from "@/lib/ai/outline";
import { researchTopic, type ResearchResult } from "@/lib/research";
import { attachmentKeywords } from "@/lib/ai/outline";
import { slugify, type Brief } from "@/lib/validation";
import {
  providerFromResolved,
  resolveProviderForRequest,
  sourceLabel,
  type ResolvedProvider,
} from "@/lib/ai/resolve";

export const STAGES = [
  { id: "research", label: "Research the topic", detail: "Searching the web and collecting candidate sources" },
  { id: "analyze", label: "Score source reliability", detail: "Ranking sources and extracting usable excerpts" },
  { id: "prereq", label: "Detect prerequisites", detail: "Comparing the topic graph against the learner profile" },
  { id: "curriculum", label: "Draft the curriculum", detail: "Turning the topic into modules, chapters and lessons" },
  { id: "lessons", label: "Write lessons and media", detail: "Explanations, diagrams and graphs" },
  { id: "playgrounds", label: "Build coding playgrounds", detail: "Runnable exercises where the topic calls for them" },
  { id: "assess", label: "Generate assessments", detail: "MCQ, true/false, short answer and code items" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

async function runStage(
  courseId: string,
  stage: StageId,
  label: string,
  fn: () => Promise<void> | void,
  onEvent?: (evt: { stage: StageId; status: string; message: string; progress: number }) => void,
) {
  const emit = onEvent ?? (() => {});
  emit({ stage, status: "running", message: label, progress: 10 });
  await prisma.generationRun.updateMany({
    where: { courseId, stage },
    data: { status: "running", progress: 10, message: label },
  });
  try {
    await fn();
    emit({ stage, status: "done", message: `${label} complete`, progress: 100 });
    await prisma.generationRun.updateMany({
      where: { courseId, stage },
      data: { status: "done", progress: 100, message: `${label} complete` },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown stage failure";
    emit({ stage, status: "failed", message, progress: 0 });
    await prisma.generationRun.updateMany({
      where: { courseId, stage },
      data: { status: "failed", message },
    });
    throw error;
  }
}

/**
 * Produce a blueprint. Uses the account or env provider when credentials exist
 * and the model returns something usable; otherwise falls back to the
 * deterministic local generator so the product is always demonstrable.
 */
async function resolveBlueprint(
  brief: Brief,
  research: BlueprintSource[],
  resolved: ResolvedProvider,
  onProgress?: (message: string, progress: number) => void,
): Promise<{ blueprint: Blueprint; source: string }> {
  if (resolved.live) {
    const provider = providerFromResolved(resolved);
    if (provider) {
      // Models do not always honour a JSON contract, so a malformed reply is
      // worth one more try. A retryable ProviderError is NOT: the provider has
      // already spent its own attempt budget on an upstream outage, and retrying
      // again here would stack two budgets and blow past the route's maxDuration.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          // Two phases: a small outline, then per-module prose that overlap.
          // See lib/ai/outline.ts for why this is not one large request.
          onProgress?.(
            attempt === 1
              ? `Planning the outline with ${resolved.model}…`
              : "Outline reply was malformed — asking once more…",
            16,
          );
          const parsed = await buildCourse(provider, brief, research, onProgress);
          if (!parsed?.modules?.length) {
            throw new Error("Model returned no modules.");
          }
          return { blueprint: parsed, source: sourceLabel(resolved) };
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.warn(`[pipeline] live attempt ${attempt} failed: ${detail}`);
          if (error instanceof ProviderError && error.retryable) {
            console.warn("[pipeline] upstream unavailable; not retrying locally.");
            break;
          }
          if (attempt === 2) {
            console.warn("[pipeline] falling back to the local generator.");
          }
        }
      }
    }
  }

  return {
    blueprint: buildBlueprint(brief.topic, brief.level, brief.goal, brief.attachments),
    source: "local",
  };
}

export interface GenerateResult {
  courseId: string;
  slug: string;
  source: string;
}

export async function generateCourse(
  brief: Brief,
  onEvent?: (evt: { stage: StageId; status: string; message: string; progress: number }) => void,
  request?: Request,
): Promise<GenerateResult> {
  // A dropped client must not abort generation: the course still lands in
  // the database, so a listener that throws (its stream is already gone) is
  // ignored instead of killing the pipeline mid-stage — which is what left
  // `analyze` stuck at "running" when the browser timed out.
  const notify = (evt: { stage: StageId; status: string; message: string; progress: number }) => {
    try {
      onEvent?.(evt);
    } catch {
      /* client disconnected */
    }
  };

  const base = slugify(brief.topic) || "course";
  let slug = base;
  for (let n = 2; await prisma.course.findUnique({ where: { slug } }); n++) slug = `${base}-${n}`;

  // Courses belong to the account that generated them. The seed (no request)
  // creates device-scope rows that are only ever visible while signed out.
  const owner = request
    ? await userFromToken(sessionTokenFromRequest(request))
    : null;

  const course = await prisma.course.create({
    data: {
      slug,
      userId: owner?.id ?? null,
      title: brief.topic,
      topic: brief.topic,
      level: brief.level,
      status: "generating",
      summary: "Generation in progress…",
    },
  });

  // Keep the learner's files with the course they shaped, so the
  // course page can show what the course was built from.
  if (brief.attachments.length > 0) {
    await prisma.attachment.createMany({
      data: brief.attachments.map((a, i) => ({
        courseId: course.id,
        name: a.name,
        kind: a.kind,
        size: a.size,
        chars: a.text.length,
        text: a.text,
        position: i + 1,
      })),
    });
  }

  await prisma.generationRun.createMany({
    data: STAGES.map((s) => ({ courseId: course.id, stage: s.id, status: "pending", progress: 0 })),
  });

  let blueprint: Blueprint | undefined;
  let research: ResearchResult = { sources: [], live: false, detail: "not run" };
  let source = "local";

  try {
    await runStage(
      course.id,
      "research",
      STAGES[0].label,
      async () => {
        research = await researchTopic(
          brief.topic,
          brief.level,
          brief.goal ?? "",
          attachmentKeywords(brief.attachments),
        );
        if (!research.live) {
          // No key or upstream failure — keep the local seed sources.
          research = { sources: [], live: false, detail: research.detail };
        }
      },
      notify,
    );

    // Resolve once: the signed-in account's provider first, then the legacy
    // env path, then the deterministic local generator.
    const resolved = await resolveProviderForRequest(request);

    await runStage(
      course.id,
      "analyze",
      STAGES[1].label,
      async () => {
        // This stage can run for minutes on a local model — surface its
        // inner progress so the UI does not look frozen on step 2.
        const outcome = await resolveBlueprint(
          brief,
          research.sources,
          resolved,
          (message, progress) => notify({ stage: "analyze", status: "running", message, progress }),
        );
        blueprint = outcome.blueprint;
        source = outcome.source;
        await new Promise((r) => setTimeout(r, 180));
      },
      notify,
    );

    await runStage(
      course.id,
      "prereq",
      STAGES[2].label,
      async () => {
        if (blueprint) {
          await prisma.prerequisite.createMany({
            data: blueprint.prerequisites.map((p) => ({ courseId: course.id, ...p })),
          });
        }
      },
      notify,
    );

    await runStage(
      course.id,
      "curriculum",
      STAGES[3].label,
      async () => {
        if (!blueprint) throw new Error("Blueprint unavailable — research stage did not complete.");
        await prisma.module.createMany({
          data: blueprint.modules.map((m, mi) => ({
            courseId: course.id,
            title: m.title,
            summary: m.summary,
            position: mi + 1,
          })),
        });
        const stored = await prisma.module.findMany({
          where: { courseId: course.id },
          orderBy: { position: "asc" },
        });
        const rows = stored.flatMap((module, mi) =>
          blueprint!.modules[mi].lessons.map((l, li) => ({
            moduleId: module.id,
            title: l.title,
            kind: l.kind,
            summary: l.summary,
            contentMd: l.contentMd,
            codeStarter: l.codeStarter ?? null,
            codeSolution: l.codeSolution ?? null,
            estMinutes: l.estMinutes,
            position: li + 1,
          })),
        );
        await prisma.lesson.createMany({ data: rows });
      },
      notify,
    );

    await runStage(
      course.id,
      "lessons",
      STAGES[4].label,
      async () => {
        // Prefer real researched sources; fall back to the blueprint's own.
        const chosen = research.sources.length > 0 ? research.sources : (blueprint?.sources ?? []);
        await prisma.source.createMany({
          data: chosen.map((s) => ({ courseId: course.id, ...s })),
        });
      },
      notify,
    );

    await runStage(
      course.id,
      "playgrounds",
      STAGES[5].label,
      async () => {
        if (!blueprint) return;
        const declared = blueprint.modules
          .flatMap((m) => m.lessons)
          .filter((l) => l.kind === "playground").length;
        if (declared === 0) return;
        const stored = await prisma.lesson.count({
          where: { module: { courseId: course.id }, kind: "playground" },
        });
        if (stored !== declared) {
          throw new Error(
            `Playground stage persisted ${stored} of ${declared} exercises — refusing to publish a partial course.`,
          );
        }
      },
      notify,
    );

    await runStage(
      course.id,
      "assess",
      STAGES[6].label,
      async () => {
        if (!blueprint) return;
        await prisma.assessment.createMany({
          data: blueprint.questions.map((q) => ({
            courseId: course.id,
            kind: q.kind,
            prompt: q.prompt,
            optionsJson: JSON.stringify(q.options),
            answer: q.answer,
            explanation: q.explanation,
            difficulty: q.difficulty,
            points: q.points,
            moduleTitle: q.moduleTitle,
          })),
        });
      },
      notify,
    );

    const modules = await prisma.module.findMany({
      where: { courseId: course.id },
      include: { lessons: true },
      orderBy: { position: "asc" },
    });
    const estMinutes = modules.flatMap((m) => m.lessons).reduce((s, l) => s + l.estMinutes, 0);

    await prisma.course.update({
      where: { id: course.id },
      data: {
        status: "published",
        summary: blueprint?.summary ?? "",
        estMinutes,
        coverStyle: blueprint?.coverStyle ?? "grid",
      },
    });

    return { courseId: course.id, slug, source };
  } catch (error) {
    await prisma.course.update({ where: { id: course.id }, data: { status: "draft" } });
    throw error;
  }
}
