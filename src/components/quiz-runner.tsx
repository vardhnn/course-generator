"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MAX_ATTEMPTS } from "@/lib/validation";

export interface QuizQuestion {
  id: string;
  kind: string;
  prompt: string;
  options: string[];
  difficulty: string;
  points: number;
  moduleTitle: string;
}

interface Outcome {
  correct: boolean;
  score: number;
  feedback: string;
  explanation: string;
}

/** A stored answer rehydrated from the server on page load. */
export interface QuizInitial {
  id: string;
  response: string;
  attempts: number;
  outcome: Outcome;
}

const KIND_LABEL: Record<string, string> = {
  mcq: "Multiple choice",
  truefalse: "True / false",
  shortanswer: "Short answer",
  code: "Coding",
};

export function QuizRunner({
  questions,
  initial = [],
}: {
  questions: QuizQuestion[];
  initial?: QuizInitial[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Hydrated from the server so a refresh (or a second tab) resumes the
  // attempt instead of showing an empty quiz the backend already graded.
  const [responses, setResponses] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((i) => [i.id, i.response])),
  );
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>(() =>
    Object.fromEntries(initial.map((i) => [i.id, i.outcome])),
  );
  const [attemptsUsed, setAttemptsUsed] = useState<Record<string, number>>(() =>
    Object.fromEntries(initial.map((i) => [i.id, i.attempts])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);

  const graded = Object.keys(outcomes).length;
  const earned = useMemo(
    () => Object.values(outcomes).reduce((s, o) => s + o.score, 0),
    [outcomes],
  );
  // The denominator is always the whole quiz. Shrink-wrapping it to the
  // answered questions made the score jump to "10 / 10" on a 70-point quiz.
  const totalPoints = useMemo(() => questions.reduce((s, q) => s + q.points, 0), [questions]);

  /** A 401 means the session is gone — sign back in and return here. */
  function toLogin() {
    router.push(`/login?next=${encodeURIComponent(pathname)}`);
  }

  async function submit(question: QuizQuestion) {
    const response = (responses[question.id] ?? "").trim();
    if (!response) return;
    setPending(question.id);
    setErrors((prev) => ({ ...prev, [question.id]: "" }));
    try {
      const res = await fetch(`/api/assessments/${question.id}/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      if (res.status === 401) {
        toLogin();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as Partial<
        Outcome & { attempts?: number; error?: string }
      >;
      if (!res.ok) {
        setErrors((prev) => ({
          ...prev,
          [question.id]: data.error ?? `Grading failed (${res.status}).`,
        }));
        return;
      }
      setOutcomes((prev) => ({
        ...prev,
        [question.id]: {
          correct: Boolean(data.correct),
          score: Number(data.score ?? 0),
          feedback: String(data.feedback ?? ""),
          explanation: String(data.explanation ?? ""),
        },
      }));
      setAttemptsUsed((prev) => ({
        ...prev,
        [question.id]: Number(data.attempts ?? (prev[question.id] ?? 0) + 1),
      }));
    } catch {
      setErrors((prev) => ({
        ...prev,
        [question.id]: "Could not reach the server. Try again.",
      }));
    } finally {
      setPending(null);
    }
  }

  /**
   * Clear resets the question locally AND deletes this account's attempts
   * server-side, so the score and the retry budget reset together instead
   * of the rows outliving the "cleared" UI.
   */
  async function clear(question: QuizQuestion) {
    setPending(question.id);
    setErrors((prev) => ({ ...prev, [question.id]: "" }));
    try {
      const res = await fetch(`/api/assessments/${question.id}/attempt`, {
        method: "DELETE",
      });
      if (res.status === 401) {
        toLogin();
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrors((prev) => ({
          ...prev,
          [question.id]: data.error ?? `Could not clear this answer (${res.status}).`,
        }));
        return;
      }
      setResponses((prev) => ({ ...prev, [question.id]: "" }));
      setOutcomes((prev) => {
        const next = { ...prev };
        delete next[question.id];
        return next;
      });
      setAttemptsUsed((prev) => ({ ...prev, [question.id]: 0 }));
    } catch {
      setErrors((prev) => ({
        ...prev,
        [question.id]: "Could not reach the server. Try again.",
      }));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="panel sticky top-[var(--header-h)] z-10 flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="meta">Score</p>
          <p className="font-display text-2xl font-semibold tabular-nums">
            {Math.round(earned * 10) / 10}
            <span className="text-ink-faint"> / {totalPoints}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="meta">Answered</p>
          <p className="font-display text-2xl font-semibold tabular-nums">
            {graded}
            <span className="text-ink-faint"> / {questions.length}</span>
          </p>
        </div>
      </section>

      {questions.map((q, i) => {
        const outcome = outcomes[q.id];
        const used = attemptsUsed[q.id] ?? 0;
        const locked = used >= MAX_ATTEMPTS;
        return (
          <section key={q.id} className="panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="meta">
                {String(i + 1).padStart(2, "0")} · {KIND_LABEL[q.kind] ?? q.kind} · {q.points} pt
              </span>
              <div className="flex gap-2">
                <span className={q.difficulty === "stretch" ? "chip chip-accent" : "chip"}>
                  {q.difficulty}
                </span>
                {outcome && (
                  <span className={outcome.correct ? "chip text-ok" : "chip text-bad"}>
                    {outcome.correct ? "correct" : "review"}
                  </span>
                )}
              </div>
            </div>

            <h3 className="font-display mt-3 text-lg font-semibold leading-snug">{q.prompt}</h3>
            {q.moduleTitle && <p className="meta mt-1">from {q.moduleTitle}</p>}

            {(q.kind === "mcq" || q.kind === "truefalse") && (
              <div className="mt-4 flex flex-col gap-2">
                {q.options.map((option) => {
                  const selected = responses[q.id] === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={Boolean(outcome)}
                      onClick={() => setResponses((prev) => ({ ...prev, [q.id]: option }))}
                      className={[
                        "flex items-center gap-3 border-2 px-4 py-2.5 text-left text-sm transition-all duration-150",
                        selected
                          ? "border-line bg-accent-wash shadow-[2px_2px_0_var(--ink)]"
                          : "border-line bg-surface-2 hover:border-line hover:shadow-[2px_2px_0_var(--ink)]",
                        outcome ? "cursor-default opacity-90" : "",
                      ].join(" ")}
                      aria-pressed={selected}
                    >
                      <span aria-hidden className="font-mono text-xs">
                        {selected ? "●" : "○"}
                      </span>
                      {option}
                    </button>
                  );
                })}
              </div>
            )}

            {q.kind === "shortanswer" && (
              <textarea
                className="textarea mt-4"
                value={responses[q.id] ?? ""}
                disabled={Boolean(outcome)}
                onChange={(e) => setResponses((prev) => ({ ...prev, [q.id]: e.target.value }))}
                placeholder="Two or three sentences is plenty."
              />
            )}

            {q.kind === "code" && (
              <textarea
                className="textarea mt-4 font-mono text-[0.8125rem]"
                style={{ minHeight: "12rem" }}
                spellCheck={false}
                value={responses[q.id] ?? ""}
                disabled={Boolean(outcome)}
                onChange={(e) => setResponses((prev) => ({ ...prev, [q.id]: e.target.value }))}
                placeholder="// paste your solution"
              />
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                className="btn btn-accent"
                onClick={() => void submit(q)}
                disabled={pending === q.id || !(responses[q.id] ?? "").trim() || locked}
              >
                {pending === q.id ? "Grading…" : outcome ? "Re-submit" : "Submit"}
              </button>
              {outcome && (
                <button className="btn btn-ghost" onClick={() => void clear(q)} disabled={pending === q.id}>
                  Clear
                </button>
              )}
              <span className="meta">
                Attempt {Math.min(used + 1, MAX_ATTEMPTS)} of {MAX_ATTEMPTS}
              </span>
            </div>

            {locked && !errors[q.id] && (
              <p className="mt-2 text-sm text-warn">
                Attempt limit reached — Clear your answer to try this question again.
              </p>
            )}
            {errors[q.id] && (
              <p role="alert" className="mt-2 text-sm text-bad">
                {errors[q.id]}
              </p>
            )}

            {outcome && (
              <div className="mt-4 border-l-4 border-line bg-paper-2 p-4 text-sm">
                <p className={outcome.correct ? "text-ok" : "text-bad"}>{outcome.feedback}</p>
                {outcome.explanation && (
                  <p className="mt-2 text-ink-soft">{outcome.explanation}</p>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
