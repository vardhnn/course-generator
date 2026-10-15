"use client";

import { useState } from "react";

interface Citation {
  lessonId: string;
  lessonTitle: string;
  moduleTitle: string;
  excerpt: string;
}

interface Turn {
  role: "you" | "tutor";
  text: string;
  citations?: Citation[];
  live?: boolean;
}

const SUGGESTIONS = [
  "What breaks most often, and why?",
  "Which stage should validate the input?",
  "Why is a silent failure so dangerous?",
  "When should I retry a stage?",
];

export function TutorChat({
  courseId,
  courseSlug,
  courseTitle,
}: {
  courseId: string;
  courseSlug: string;
  courseTitle: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);

  async function ask(text: string) {
    const value = text.trim();
    if (!value || pending) return;
    setQuestion("");
    setTurns((prev) => [...prev, { role: "you", text: value }]);
    setPending(true);
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, question: value }),
      });
      const data = (await res.json()) as {
        answer?: string;
        citations?: Citation[];
        live?: boolean;
        error?: string;
      };
      setTurns((prev) => [
        ...prev,
        data.answer
          ? { role: "tutor", text: data.answer, citations: data.citations ?? [], live: data.live }
          : { role: "tutor", text: data.error ?? "The tutor could not answer that." },
      ]);
    } catch {
      setTurns((prev) => [...prev, { role: "tutor", text: "Network error talking to the tutor." }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="meta">Grounded on</p>
            <p className="font-display text-lg font-semibold">{courseTitle}</p>
          </div>
          <span className="chip">Enrolled lessons only</span>
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          This tutor reads the course you are enrolled in. It will not answer from the open web.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="btn btn-ghost" onClick={() => void ask(s)} disabled={pending}>
              {s}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        {turns.length === 0 && (
          <p className="text-sm text-ink-faint">
            No questions yet. Pick a suggestion above or type your own.
          </p>
        )}

        {turns.map((turn, i) => (
          <article
            key={i}
            className={turn.role === "you" ? "card ml-auto max-w-[85%] p-4" : "panel p-5"}
          >
            <p className="meta">{turn.role === "you" ? "You" : "Tutor"}</p>
            <div className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap">
              {turn.text.replace(/\*\*(.+?)\*\*/g, "$1")}
            </div>

            {turn.citations && turn.citations.length > 0 && (
              <ul className="mt-4 flex flex-col gap-2 border-t border-line-soft pt-3">
                {turn.citations.map((c) => (
                  <li key={c.lessonId}>
                    <a
                      href={`/course/${courseSlug}/lesson/${c.lessonId}`}
                      className="chip underline-offset-4 hover:underline"
                    >
                      {c.lessonTitle}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {turn.live === false && turn.role === "tutor" && (
              <p className="meta mt-3">answered from course text · no model configured</p>
            )}
          </article>
        ))}

        {pending && (
          <article className="panel p-5">
            <p className="meta">Tutor</p>
            <p className="mt-1.5 text-sm text-ink-soft">
              Reading the course<span className="caret ml-1" aria-hidden />
            </p>
          </article>
        )}
      </section>

      <form
        className="sticky bottom-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label className="sr-only" htmlFor="tutor-question">
          Ask the tutor
        </label>
        <input
          id="tutor-question"
          className="input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about anything in this course…"
          disabled={pending}
        />
        <button className="btn btn-accent" type="submit" disabled={pending || !question.trim()}>
          {pending ? "…" : "Ask"}
        </button>
      </form>
    </div>
  );
}