import { z } from "zod";

export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Level = (typeof LEVELS)[number];

export const LESSON_KINDS = ["reading", "playground"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const QUESTION_KINDS = ["mcq", "truefalse", "shortanswer", "code"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/**
 * Attempts per question before the quiz locks it. A learner can retry, but
 * not grind until the right answer sticks — and Clear frees the budget.
 */
export const MAX_ATTEMPTS = 3;

export const LEVEL_BLURB: Record<Level, string> = {
  beginner: "Starts from first principles. Assumes you can already use a computer.",
  intermediate: "Assumes the fundamentals. Moves into tradeoffs and edge cases.",
  advanced: "Assumes fluency. Focuses on internals, performance and design judgment.",
};

/** What the file most likely is, so the AI can weight it correctly. */
export const ATTACHMENT_KINDS = ["text", "code", "data", "notes"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** Upload budget: a handful of focused files beats a wall of text. */
export const MAX_ATTACHMENTS = 6;
export const MAX_ATTACHMENT_CHARS = 30_000;
export const MAX_ATTACHMENT_TOTAL_CHARS = 120_000;

export const AttachmentBriefSchema = z.object({
  name: z.string().trim().min(1, "Every attachment needs a name.").max(120),
  kind: z.enum(ATTACHMENT_KINDS).default("text"),
  /** Bytes as uploaded, kept for display only. */
  size: z.number().int().min(0).max(8 * 1024 * 1024).default(0),
  text: z.string().max(MAX_ATTACHMENT_CHARS, "One attachment is too long — split it up."),
});

export type AttachmentBrief = z.infer<typeof AttachmentBriefSchema>;

export const BriefSchema = z
  .object({
    topic: z.string().trim().min(3, "Give the topic at least 3 characters.").max(120),
    level: z.enum(LEVELS),
    goal: z.string().trim().max(200).optional().default(""),
    attachments: z
      .array(AttachmentBriefSchema)
      .max(MAX_ATTACHMENTS, `At most ${MAX_ATTACHMENTS} attachments.`)
      .default([]),
  })
  .superRefine((brief, ctx) => {
    const total = brief.attachments.reduce((s, a) => s + a.text.length, 0);
    if (total > MAX_ATTACHMENT_TOTAL_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Attachments total ${total.toLocaleString()} characters — the limit is ${MAX_ATTACHMENT_TOTAL_CHARS.toLocaleString()}. Trim or drop a file.`,
      });
    }
  });

export type Brief = z.infer<typeof BriefSchema>;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

/** Stable 32-bit hash so the mock provider returns identical output for the same topic. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function formatMinutes(total: number): string {
  if (total <= 0) return "0m";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Validate a post-login redirect target. "/"-prefixed is necessary but not
 * sufficient: browsers treat "//host" and "/\\host" as protocol-relative
 * URLs, which would bounce a fresh session off-site.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}