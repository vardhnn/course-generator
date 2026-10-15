import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, userFromToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = {
  // absolute: the landing page IS the brand name — no template suffix.
  title: { absolute: "Retro Course Studio" },
  description:
    "Describe what you want to learn. The studio researches it, scores the sources, writes the course and grades you on what it wrote.",
};

const FEATURES = [
  {
    title: "Researched, not invented",
    body: "Every course starts with a live web search. Sources are scored for reliability and only the ones that pass the gate reach the curriculum.",
  },
  {
    title: "Written, not templated",
    body: "Lessons, diagrams, playgrounds and assessments are written per course — then graded against the exact text you read.",
  },
  {
    title: "Seven stages, all visible",
    body: "Research, source scoring, prerequisites, curriculum, lessons, playgrounds and assessments. You watch each stage run, and every one is recorded.",
  },
];

export default async function HomePage() {
  // The hero CTA follows the visitor: signed-in users go to the
  // dashboard, everyone else lands straight on account creation.
  const user = await userFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="rise flex flex-col items-start py-12 sm:py-16">
        <p className="meta">Retro Course Studio</p>
        <h1 className="font-display mt-2 max-w-3xl text-4xl font-semibold leading-[1.1] sm:text-5xl">
          Learn like the notes were printed.
          <span className="block text-ink-soft">Built like the syllabus was engineered.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-base text-ink-soft sm:text-lg">
          Name a topic. The studio researches it, scores the sources, works out what you are
          missing, then writes the whole course — lessons, diagrams, runnable playgrounds and
          assessments that only test what it taught you.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/generate" className="btn btn-accent">
            Generate a course
          </Link>
          {user ? (
            <Link href="/dashboard" className="btn">
              Dashboard
            </Link>
          ) : (
            <Link href="/login?mode=signup" className="btn">
              Create an account
            </Link>
          )}
        </div>
      </section>

      {/* Feature strip */}
      <section className="grid gap-3 py-4 sm:grid-cols-3">
        {FEATURES.map((f, i) => (
          <article key={f.title} className="card p-5" style={{ animationDelay: `${i * 70}ms` }}>
            <h2 className="font-display text-lg font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-ink-soft">{f.body}</p>
          </article>
        ))}
      </section>

      {/* How it works */}
      <section className="panel mt-6 p-6 sm:p-8">
        <p className="meta">How a course is made</p>
        <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Name the topic", "One line, a level, and optionally what you want to be able to do."],
            ["Watch it build", "Live progress per stage, from research through to grading."],
            ["Read and run", "Lessons with diagrams, plus playgrounds you can execute in place."],
            ["Get graded", "Assessments are generated from the lesson text — nothing borrowed."],
          ].map(([h, b], i) => (
            <li key={h} className="flex flex-col gap-1">
              <span className="meta text-accent">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-display font-semibold">{h}</span>
              <span className="text-sm text-ink-soft">{b}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Closing call to action */}
      <section className="hatch mt-6 flex flex-col items-start gap-3 border-2 border-line bg-accent-wash/40 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <h2 className="font-display text-2xl font-semibold">Your first course is one line away.</h2>
          <p className="mt-1 text-sm text-ink-soft">
            No setup, no syllabus to draft. Type what you want to understand.
          </p>
        </div>
        <Link href="/generate" className="btn btn-accent shrink-0">
          Start now
        </Link>
      </section>
    </div>
  );
}
