"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Paperclip, Timer, Upload, X } from "lucide-react";
import { BackToDashboard } from "@/components/back-to-dashboard";
import { formatBytes } from "@/lib/format";
import {
  LEVELS,
  LEVEL_BLURB,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_CHARS,
  MAX_ATTACHMENT_TOTAL_CHARS,
  type AttachmentBrief,
  type AttachmentKind,
  type Level,
} from "@/lib/validation";

interface StagePlan {
  id: string;
  label: string;
  detail: string;
}

interface StageState extends StagePlan {
  status: "pending" | "running" | "done" | "failed";
  message: string;
}

const GLYPH: Record<StageState["status"], string> = {
  pending: "○",
  running: "◐",
  done: "●",
  failed: "✕",
};

/* File attachments — classified by extension so the AI can weight
   a syllabus differently from a code sample. Anything unrecognised
   is treated as notes. */
const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|cs|php|swift|sh|bash|sql|lua|scala|hs|ex|exs|dart|vue|svelte)$/i;
const DATA_EXT = /\.(json|jsonl|ndjson|csv|tsv|ya?ml|xml|toml|ini|env|graphql|gql)$/i;
const TEXT_EXT = /\.(txt|md|markdown|mdx|log|org|rst|text)$/i;
const ACCEPT =
  ".txt,.text,.md,.markdown,.mdx,.log,.org,.rst,.json,.jsonl,.ndjson,.csv,.tsv,.yaml,.yml,.xml,.toml,.ini,.env,.graphql,.gql,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.cs,.php,.swift,.sh,.bash,.sql,.lua,.scala,.hs,.ex,.exs,.dart,.vue,.svelte";

/** One-click starting points, mirroring the placeholder examples. */
const TOPIC_CHIPS = [
  "distributed consensus",
  "type theory",
  "shader programming",
  "Rust ownership",
  "prompt engineering",
  "compiler design",
];

function kindOf(name: string): AttachmentKind {
  if (CODE_EXT.test(name)) return "code";
  if (DATA_EXT.test(name)) return "data";
  if (TEXT_EXT.test(name)) return "text";
  return "notes";
}

/** The DOM decoder replaces undecodable bytes with U+FFFD — a decent
    binary guard without magic-number sniffing. */
function looksBinary(text: string): boolean {
  return (text.match(/�/g) ?? []).length > 8 || text.includes("\x00");
}

export function GenerateClient({ providerLabel }: { providerLabel: string }) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState<Level>("beginner");
  const [goal, setGoal] = useState("");
  const [stages, setStages] = useState<StageState[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ slug: string; source: string } | null>(null);
  const [attachments, setAttachments] = useState<AttachmentBrief[]>([]);
  const [trimmedNames, setTrimmedNames] = useState<string[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const submit = useCallback(async () => {
    setError(null);
    setResult(null);
    setAttachError(null);
    setRunning(true);
    setStages([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, level, goal, attachments }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Generation request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line) as
            | { type: "plan"; stages: StagePlan[] }
            | { type: "stage"; stage: string; status: StageState["status"]; message: string }
            | { type: "done"; slug: string; source: string }
            | { type: "error"; message: string }
            | { type: "ping" };

          if (evt.type === "plan") {
            setStages(evt.stages.map((s) => ({ ...s, status: "pending", message: "" })));
          } else if (evt.type === "stage") {
            setStages((prev) =>
              prev.map((s) =>
                s.id === evt.stage ? { ...s, status: evt.status, message: evt.message } : s,
              ),
            );
          } else if (evt.type === "done") {
            setResult({ slug: evt.slug, source: evt.source });
          } else if (evt.type === "error") {
            setError(evt.message);
          }
          // "ping" is a keep-alive: no UI change, it only proves the long
          // local-model stage is still alive on the server.
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [topic, level, goal, attachments]);

  /** Read each picked file as text and keep it as structured context.
      Limits are enforced here so the API never receives more than the
      schema allows — the server re-checks regardless. */
  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setAttachError(null);
      const picked: AttachmentBrief[] = [];
      const trimmed: string[] = [];
      for (const file of Array.from(files)) {
        if (attachments.length + picked.length >= MAX_ATTACHMENTS) {
          setAttachError(
            `At most ${MAX_ATTACHMENTS} files — "${file.name}" was skipped.`,
          );
          break;
        }
        if (file.size > 8 * 1024 * 1024) {
          setAttachError(`"${file.name}" is over 8 MB — too large to attach.`);
          continue;
        }
        let text: string;
        try {
          text = await file.text();
        } catch {
          setAttachError(`Could not read "${file.name}".`);
          continue;
        }
        if (looksBinary(text)) {
          setAttachError(
            `"${file.name}" looks like a binary file. Attach text-based files — notes, markdown, JSON, code.`,
          );
          continue;
        }
        if (text.length > MAX_ATTACHMENT_CHARS) {
          text = text.slice(0, MAX_ATTACHMENT_CHARS);
          trimmed.push(file.name);
        }
        const carried = [...attachments, ...picked].reduce(
          (sum, a) => sum + a.text.length,
          0,
        );
        if (carried + text.length > MAX_ATTACHMENT_TOTAL_CHARS) {
          setAttachError(
            `Attachments together are capped at ${(MAX_ATTACHMENT_TOTAL_CHARS / 1000).toLocaleString()}k characters — "${file.name}" was skipped.`,
          );
          continue;
        }
        picked.push({ name: file.name, kind: kindOf(file.name), size: file.size, text });
      }
      if (picked.length > 0) setAttachments((prev) => [...prev, ...picked]);
      if (trimmed.length > 0) setTrimmedNames((prev) => [...prev, ...trimmed]);
    },
    [attachments],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setTrimmedNames((prev) => prev.filter((_, i) => i < index || i > index));
  }, []);

  const done = stages.filter((s) => s.status === "done").length;
  const active = stages.findIndex((s) => s.status === "running");
  const percent = stages.length === 0 ? 0 : Math.round((done / stages.length) * 100);

  return (
    <div className="flex flex-col gap-6 py-8">
      <BackToDashboard />
      <header className="rise">
        <p className="meta">New course</p>
        <h1 className="font-display mt-1 text-3xl font-semibold">Name the topic.</h1>
        <p className="mt-1 max-w-xl text-sm text-ink-soft">
          Each stage reports here live while the course is written.
        </p>
        {/* What will actually serve the request — answered before the form,
            not after the eight minutes are spent. */}
        <p className="meta mt-3 flex flex-wrap items-center gap-2">
          <span aria-hidden>·</span>
          Using <span className="text-ink">{providerLabel}</span>
        </p>
      </header>

      <section className="panel rise p-5">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!running) void submit();
          }}
        >
          <label className="labelled">
            <span className="meta">Topic</span>
            <input
              className="input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. distributed consensus, type theory, shader programming"
              disabled={running}
              required
              minLength={3}
              maxLength={120}
            />
          </label>

          {/* The placeholder's examples, now clickable. */}
          <div className="flex flex-wrap gap-2">
            {TOPIC_CHIPS.map((t) => (
              <button
                key={t}
                type="button"
                className="chip transition-colors hover:bg-surface-2"
                onClick={() => setTopic(t)}
                disabled={running}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="labelled">
            <span className="meta">Level</span>
            <div className="segment" role="group" aria-label="Difficulty level">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  data-active={level === l}
                  onClick={() => setLevel(l)}
                  disabled={running}
                  aria-pressed={level === l}
                >
                  {l}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-soft">{LEVEL_BLURB[level]}</p>
          </div>

          <label className="labelled">
            <span className="meta">Goal (optional)</span>
            <input
              className="input"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. so I can read a production codebase without guessing"
              disabled={running}
              maxLength={200}
            />
          </label>

          <div className="labelled">
            <span className="meta">Context files (optional)</span>
            {/* A dropzone instead of the bare OS file control: click to
                browse, or drop files straight onto the bordered area. */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!running) setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (!running) void onFiles(e.dataTransfer.files);
              }}
              className={[
                "flex cursor-pointer flex-col items-center justify-center gap-1 border-2 border-dashed px-4 py-6 text-center transition-colors",
                dragOver
                  ? "border-accent bg-accent-wash/40"
                  : "border-line hover:border-ink-soft hover:bg-surface-2/50",
                running ? "pointer-events-none opacity-60" : "",
              ].join(" ")}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              aria-label="Add context files"
            >
              <Upload aria-hidden className="size-5 text-ink-soft" />
              <p className="text-sm text-ink">
                Drop files here, or <span className="underline underline-offset-2">browse</span>
              </p>
              <p className="text-xs text-ink-soft">
                Syllabi, notes, topic lists or code — up to {MAX_ATTACHMENTS} files and{" "}
                {(MAX_ATTACHMENT_TOTAL_CHARS / 1000).toLocaleString()}k characters in total.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                accept={ACCEPT}
                onChange={(e) => {
                  void onFiles(e.target.files);
                  // Allow picking the same file twice.
                  e.target.value = "";
                }}
                disabled={running}
                aria-describedby="attach-help"
              />
            </div>
            <p id="attach-help" className="sr-only">
              The studio builds the course around what you attach.
            </p>
            {attachments.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {attachments.map((a, i) => (
                  <li
                    key={`${a.name}-${i}`}
                    className="chip normal-case! tracking-normal!"
                  >
                    <Paperclip aria-hidden className="size-3" />
                    <span className="max-w-48 truncate">{a.name}</span>
                    <span className="text-ink-faint">{a.kind}</span>
                    <span className="text-ink-faint">{formatBytes(a.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      disabled={running}
                      aria-label={`Remove ${a.name}`}
                      className="text-ink-soft transition-colors hover:text-bad"
                    >
                      <X aria-hidden className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {trimmedNames.length > 0 && (
              <p className="text-xs text-warn">
                Trimmed to {(MAX_ATTACHMENT_CHARS / 1000).toLocaleString()}k characters:
                {trimmedNames.join(", ")}
              </p>
            )}
            {attachError && (
              <p role="alert" className="text-xs text-bad">
                {attachError}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button className="btn btn-accent" type="submit" disabled={running || topic.trim().length < 3}>
              {running ? "Generating…" : "Generate course"}
            </button>
            {running && (
              <button className="btn btn-ghost" type="button" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            )}
            {/* The honest cost of the click: how long this takes and that
                the dashboard keeps showing progress if you navigate away. */}
            {!running && (
              <p className="flex items-center gap-1.5 text-xs text-ink-soft">
                <Timer aria-hidden className="size-3.5" />
                Typically 5–10 minutes · you can leave this page — the dashboard keeps
                watch while it runs.
              </p>
            )}
          </div>
        </form>
      </section>

      {stages.length > 0 && (
        <section className="panel rise overflow-hidden p-0">
          <div className="flex items-center justify-between gap-3 border-b-2 border-line px-5 py-3">
            <span className="meta">Pipeline</span>
            <span className="font-mono text-xs tabular-nums">{percent}%</span>
          </div>
          <ol className="relative">
            <div className="scanline" aria-hidden />
            {stages.map((s, i) => (
              <li
                key={s.id}
                className={[
                  "flex items-start gap-3 border-b border-line-soft px-5 py-3 transition-colors duration-300",
                  i === active ? "bg-accent-wash/40" : "",
                ].join(" ")}
              >
                <span
                  aria-hidden
                  className={[
                    "mt-0.5 w-4 text-center font-mono text-sm",
                    s.status === "done"
                      ? "text-ok"
                      : s.status === "running"
                        ? "text-accent"
                        : s.status === "failed"
                          ? "text-bad"
                          : "text-ink-faint",
                  ].join(" ")}
                >
                  {GLYPH[s.status]}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={[
                      "text-sm",
                      s.status === "pending" ? "text-ink-faint" : "text-ink",
                    ].join(" ")}
                  >
                    {s.label}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {s.message || s.detail}
                    {s.status === "running" && <span className="caret ml-1" aria-hidden />}
                  </p>
                </div>
                <span className="meta tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {error && (
        <section className="panel rise border-bad p-5">
          <p className="meta text-bad">Generation failed</p>
          <p className="mt-1 text-sm">{error}</p>
        </section>
      )}

      {result && (
        <section className="panel rise flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="meta">Course ready</p>
            <p className="mt-1 text-sm text-ink-soft">
              Generated via <span className="font-mono">{result.source}</span>.
            </p>
          </div>
          <div className="flex gap-3">
            <Link href={`/course/${result.slug}`} className="btn btn-accent">
              Open course
            </Link>
            <button className="btn" type="button" onClick={() => router.refresh()}>
              Generate another
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
