import type { AttachmentBrief, Level, LessonKind, QuestionKind } from "@/lib/validation";
import { hashString } from "@/lib/validation";

export interface BlueprintLesson {
  title: string;
  kind: LessonKind;
  summary: string;
  contentMd: string;
  codeStarter?: string;
  codeSolution?: string;
  estMinutes: number;
}

export interface BlueprintModule {
  title: string;
  summary: string;
  lessons: BlueprintLesson[];
}

export interface BlueprintSource {
  title: string;
  url: string;
  publisher: string;
  reliability: number;
  snippet: string;
}

export interface BlueprintPrerequisite {
  title: string;
  reason: string;
  status: "missing" | "covered" | "teaching";
}

export interface BlueprintQuestion {
  kind: QuestionKind;
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
  difficulty: "core" | "stretch";
  points: number;
  moduleTitle: string;
}

export interface Blueprint {
  summary: string;
  estMinutes: number;
  coverStyle: string;
  modules: BlueprintModule[];
  sources: BlueprintSource[];
  prerequisites: BlueprintPrerequisite[];
  questions: BlueprintQuestion[];
}

/* ------------------------------------------------------------------ */
/* Deterministic pickers — same topic + level always yields one course  */
/* ------------------------------------------------------------------ */

function makeRng(seed: number) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

/* ------------------------------------------------------------------ */
/* Markdown builders                                                   */
/* ------------------------------------------------------------------ */

function readingLesson(topic: string, title: string, focus: string, extra: string[]): string {
  const points = extra.map((p) => `- ${p}`).join("\n");
  return `## Why this matters

${title} is one of the ideas you actually need to hold in your head to use ${topic} well. Most confusion in ${topic} comes from skipping it and pattern-matching instead.

## The core idea

${focus} The useful mental model is to think of ${topic} as a pipeline with explicit hand-offs. Each stage takes something well-defined, does one job, and hands a well-defined result onward. When a stage does two jobs, that is where surprises live.

\`\`\`text
  input ──▶ [normalise] ──▶ [transform] ──▶ [validate] ──▶ output
                │               │                │
             rejected        lossy           rejected
\`\`\`

If a stage ever rejects your input, it should say *which* stage rejected it and *why*. A vague failure is far more expensive than a loud one.

## Worked example

Take a small case and trace it end to end. Write down the value at every hand-off. Two things become obvious immediately: which stage owns the interesting behaviour, and where information is being lost.

${points}

> **Key point** — if you cannot explain the hand-off between two stages, you do not yet understand where the difficulty lives.

## Check your understanding

- What does each stage in the diagram own exclusively?
- Which stage is the first place you would add validation, and why there rather than earlier?
- What information is lost between the stages you traced?
`;
}

function playgroundLesson(topic: string, title: string, task: string): string {
  return `## The exercise

${task} Everything you need is already wired up. Run the starter, read the failure, then fix it.

The point is not to reach the answer quickly. It is to notice which step surprised you — that step is the one you did not actually understand yet.

\`\`\`text
  starter ──▶ run ──▶ read failure ──▶ patch ──▶ run ──▶ compare to solution
\`\`\`

> **Key point** — a failing case you cannot explain is worth more than a passing case you copied.

## Check your understanding

- What did the failing output tell you that the passing output did not?
- Which line carries the responsibility if this breaks in production?
- What would you change about the ${topic} design to make this class of bug impossible?
`;
}

const STARTER = `// Two problems hide in here.
// 1. The pipeline rejects good input.
// 2. Nothing tells you WHICH stage rejected it.

function normalise(input) {
  return input.trim();
}

function transform(value) {
  return value.split(",").map((s) => Number(s.trim()));
}

function validate(values) {
  if (!values.every((n) => Number.isFinite(n))) {
    throw new Error("validation failed");
  }
  return values;
}

export function run(raw) {
  const normalised = normalise(raw);
  const values = transform(normalised);
  return validate(values);
}

console.log(run("1, 2, 3"));
console.log(run("1, two, 3"));
`;

const SOLUTION = `// Fix: validate each stage's output before handing it on,
// and name the stage in every error so failures are self-describing.

function normalise(input) {
  return input.trim();
}

function transform(value) {
  return value.split(",").map((s) => Number(s.trim()));
}

function validate(values) {
  const bad = values.findIndex((n) => !Number.isFinite(n));
  if (bad !== -1) {
    throw new Error(\`validate: value at index \${bad} is not a finite number\`);
  }
  return values;
}

export function run(raw) {
  const normalised = normalise(raw);
  const values = transform(normalised);
  return validate(values);
}

console.log(run("1, 2, 3"));
try {
  console.log(run("1, two, 3"));
} catch (err) {
  console.log(err.message); // validate: value at index 1 is not a finite number
}
`;

/* ------------------------------------------------------------------ */
/* Module shapes                                                       */
/* ------------------------------------------------------------------ */

interface ModuleSpec {
  title: string;
  summary: string;
  lessons: Array<{ title: string; kind: LessonKind; focus: string; extra: string[]; task?: string }>;
}

function moduleSpecs(topic: string, level: Level, attachments: AttachmentBrief[]): ModuleSpec[] {
  const advanced = level === "advanced";
  const beginner = level === "beginner";

  const specs: ModuleSpec[] = [
    {
      title: `Foundations of ${topic}`,
      summary: `Where ${topic} came from, the problem it solves, and the vocabulary you need before anything else.`,
      lessons: [
        {
          title: `What problem ${topic} solves`,
          kind: "reading",
          focus: `${topic} exists to remove a specific, recurring pain. Naming that pain precisely is most of the work.`,
          extra: beginner
            ? [
                "The constraint that forced the design, stated plainly",
                "What the obvious first attempt gets wrong",
                "The one-sentence definition you should be able to recite",
              ]
            : [
                "The historical constraint that produced the current shape",
                "Which parts are load-bearing and which are historical accident",
              ],
        },
        {
          title: `Core vocabulary and mental models`,
          kind: "reading",
          focus: `Every practitioner you admire uses the same handful of mental models for ${topic}. Learn those first.`,
          extra: [
            "The three terms you will hear in every code review",
            "The one diagram that makes the rest obvious",
          ],
        },
        // The learner's own files are the highest-signal context they
        // can give, so they get a dedicated lesson rather than being
        // folded into the generic vocabulary list.
        ...(attachments.length > 0
          ? [
              {
                title: "The attached materials",
                kind: "reading" as LessonKind,
                focus: `The learner brought ${attachments.length} file(s). Treat them as the primary source: the course exists to make them fully intelligible.`,
                extra: attachments.slice(0, 4).map(
                  (a) =>
                    `"${a.name}" (${a.kind}) — ${a.text.length.toLocaleString()} characters of context`,
                ),
              },
            ]
          : []),
      ],
    },
    {
      title: `How ${topic} actually works`,
      summary: `The mechanics. What happens between input and output, stage by stage.`,
      lessons: [
        {
          title: `Anatomy of a ${topic} request`,
          kind: "reading",
          focus: `Follow one concrete case through the whole system. The stages are the same every time — that is the point.`,
          extra: [
            "Where the work is cheap and where it is expensive",
            "Which stage is safe to retry and which is not",
          ],
        },
        {
          title: `Build it yourself`,
          kind: "playground",
          focus: "",
          extra: [],
          task: `Write a small ${topic} pipeline yourself. Two bugs are deliberately planted in the starter — find both before looking at the solution.`,
        },
      ],
    },
    {
      title: `Edge cases and failure modes`,
      summary: `Where it breaks, and how the good practitioners notice before their users do.`,
      lessons: [
        {
          title: `The inputs that break ${topic}`,
          kind: "reading",
          focus: `Every real system is defined by its worst input, not its best one. This lesson is the catalogue.`,
          extra: [
            "Empty, enormous, and adversarial inputs",
            "The silent-corruption failure, and why it is the dangerous one",
            "Backpressure: saying no is a feature",
          ],
        },
        {
          title: advanced ? `Performance and cost model` : `Debugging ${topic} in the wild`,
          kind: "reading",
          focus: advanced
            ? `Where the time and the money actually go, and which optimisations survive contact with real traffic.`
            : `A repeatable method for narrowing an unknown failure without guessing.`,
          extra: advanced
            ? ["The cost of each stage, measured rather than assumed", "Which optimisations are worth the complexity"]
            : ["Bisect, don't guess", "Write the failing case down before changing anything"],
        },
      ],
    },
    {
      title: `Judgment and practice`,
      summary: `When to reach for ${topic}, when not to, and what good looks like in review.`,
      lessons: [
        {
          title: `Choosing an approach`,
          kind: "reading",
          focus: `Most ${topic} decisions are trade-offs with no dominant option. Learn which axis matters for your problem.`,
          extra: [
            "The three approaches you will realistically consider",
            "The one that wins when you optimise for boring reliability",
          ],
        },
        {
          title: `Capstone`,
          kind: "playground",
          focus: "",
          extra: [],
          task: `Extend your pipeline with validation, a clear error contract and one retryable stage. Compare your result against the solution and note every design difference.`,
        },
      ],
    },
  ];

  if (advanced) {
    specs.splice(2, 0, {
      title: `Internals of ${topic}`,
      summary: `What is happening under the abstraction, and which of those details you are allowed to depend on.`,
      lessons: [
        {
          title: `Below the abstraction`,
          kind: "reading",
          focus: `Trace one operation all the way down. Most surprises in production live at a boundary you were told not to cross.`,
          extra: [
            "The stable contract versus the incidental implementation",
            "Which guarantees are documented and which are merely observed",
          ],
        },
      ],
    });
  }

  return specs;
}

/* ------------------------------------------------------------------ */
/* Blueprint                                                           */
/* ------------------------------------------------------------------ */

export function buildBlueprint(
  topic: string,
  level: Level,
  goal = "",
  attachments: AttachmentBrief[] = [],
): Blueprint {
  const rng = makeRng(
    hashString(
      `${topic.toLowerCase()}|${level}|${attachments.map((a) => a.name).join(",")}`,
    ),
  );
  const beginner = level === "beginner";
  const advanced = level === "advanced";
  const specs = moduleSpecs(topic, level, attachments);

  const modules: BlueprintModule[] = specs.map((spec, i) => ({
    title: spec.title,
    summary: spec.summary,
    lessons: spec.lessons.map((l) => ({
      title: l.title,
      kind: l.kind,
      summary: l.kind === "playground" ? "Hands-on — write it, run it, break it." : "Reading — build the mental model.",
      contentMd:
        l.kind === "playground"
          ? playgroundLesson(topic, l.title, l.task ?? "Complete the exercise.")
          : readingLesson(topic, l.title, l.focus, l.extra),
      codeStarter: l.kind === "playground" ? STARTER : undefined,
      codeSolution: l.kind === "playground" ? SOLUTION : undefined,
      estMinutes: l.kind === "playground" ? 18 : 9 + Math.floor(rng() * 6),
    })),
  }));

  const estMinutes = modules.reduce(
    (sum, m) => sum + m.lessons.reduce((s, l) => s + l.estMinutes, 0),
    0,
  );

  const publishers = ["Official documentation", "Engineering blog", "Academic paper", "Reference implementation", "Standards body"];
  const sources: BlueprintSource[] = [
    {
      title: `${topic}: official guide`,
      url: `https://example.org/${encodeURIComponent(topic.toLowerCase().replace(/\s+/g, "-"))}/guide`,
      publisher: pick(rng, publishers),
      reliability: 96,
      snippet: `Primary specification for ${topic}. Defines the contract every other source is downstream of.`,
    },
    {
      title: `How ${topic} works in production`,
      url: `https://example.org/${encodeURIComponent(topic.toLowerCase().replace(/\s+/g, "-"))}/in-production`,
      publisher: "Engineering blog",
      reliability: 82,
      snippet: `Operational experience from a large deployment, including the failure modes that only appear under load.`,
    },
    {
      title: `Foundations of ${topic}`,
      url: `https://example.org/${encodeURIComponent(topic.toLowerCase().replace(/\s+/g, "-"))}/foundations`,
      publisher: "Academic paper",
      reliability: 74,
      snippet: `The original derivation. Useful for intent, dated for current practice.`,
    },
    {
      title: `${topic} reference implementation`,
      url: `https://example.org/${encodeURIComponent(topic.toLowerCase().replace(/\s+/g, "-"))}/reference`,
      publisher: "Reference implementation",
      reliability: 88,
      snippet: "Annotated source. The fastest way to settle arguments about actual behaviour.",
    },
    {
      title: `Common ${topic} mistakes`,
      url: `https://example.org/${encodeURIComponent(topic.toLowerCase().replace(/\s+/g, "-"))}/mistakes`,
      publisher: "Community reference",
      reliability: 61,
      snippet: "Anecdotal but well-sourced. Treated as a checklist, not as authority.",
    },
  ];

  const prerequisites: BlueprintPrerequisite[] = [
    {
      title: `Comfort reading ${topic} documentation`,
      reason: "Primary sources assume you can parse a specification without hand-holding.",
      status: "covered",
    },
    {
      title: "Tracing a value through a call stack",
      reason: "Every debugging lesson in this course depends on it.",
      status: level === "beginner" ? "teaching" : "missing",
    },
    {
      title: `Reading ${pick(rng, ["a stack trace", "a latency graph", "a diff"])} without panic`,
      reason: "Needed for the edge-case module.",
      status: level === "beginner" ? "teaching" : "missing",
    },
    {
      title: "Writing a small program with error handling",
      reason: "The playground lessons assume you have done this before.",
      status: beginner ? "teaching" : "missing",
    },
  ];

  const questions: BlueprintQuestion[] = [
    {
      kind: "mcq",
      prompt: `In a typical ${topic} pipeline, which stage should own validating the shape of its input?`,
      options: [
        "The first stage that touches the value, before any transformation",
        "The last stage, just before the result is returned",
        "Whichever stage is easiest to modify",
        "Validation should be duplicated across every stage",
      ],
      answer: "The first stage that touches the value, before any transformation",
      explanation:
        "Validating at the boundary keeps rejections cheap and attributable. Once a bad value has been transformed, the error message describes the transform, not the mistake.",
      difficulty: "core",
      points: 1,
      moduleTitle: modules[1].title,
    },
    {
      kind: "truefalse",
      prompt: `A failure message that names the stage which rejected the input is always preferable to one that only reports that "validation failed".`,
      options: ["True", "False"],
      answer: "True",
      explanation:
        "Self-describing failures cut debugging time disproportionately, because the failing stage is usually already half the investigation.",
      difficulty: "core",
      points: 1,
      moduleTitle: modules[1].title,
    },
    {
      kind: "shortanswer",
      prompt: `Name the failure mode where ${topic} accepts bad input and produces plausible-looking but incorrect output. Why is it more dangerous than a hard failure?`,
      options: [],
      answer:
        "Silent corruption. It is more dangerous because nothing raises an alarm: the error surfaces far downstream, after the bad value has been stored, trusted and acted on.",
      explanation:
        "Detecting it early is the whole argument for validating at boundaries and for preferring loud failures.",
      difficulty: "stretch",
      points: 2,
      moduleTitle: modules[2].title,
    },
    {
      kind: "mcq",
      prompt: `Which stage is typically safe to retry after a timeout in ${topic}?`,
      options: [
        "A pure stage with no side effects",
        "Any stage, because retrying is always safe",
        "The stage that writes the final output",
        "The first stage that performs I/O",
      ],
      answer: "A pure stage with no side effects",
      explanation:
        "Retry safety follows from side effects, not from optimism. A pure stage can be re-run any number of times with identical results.",
      difficulty: "core",
      points: 1,
      moduleTitle: modules[2].title,
    },
    {
      kind: "code",
      prompt: `Add validation to this stage so it rejects non-numeric values and names the index that failed.`,
      options: [],
      answer: SOLUTION,
      explanation:
        "The reference solution checks each value, reports the offending index, and keeps the error message self-describing.",
      difficulty: "stretch",
      points: 3,
      moduleTitle: modules[3].title,
    },
    {
      kind: "truefalse",
      prompt: `Once you have understood ${topic} at the level of its documented contract, studying the implementation internals is optional.`,
      options: ["True", "False"],
      answer: "False",
      explanation:
        "Internals tell you which documented guarantees are load-bearing. Relying on undocumented behaviour is exactly what breaks during upgrades.",
      difficulty: level === "advanced" ? "core" : "stretch",
      points: 1,
      moduleTitle: modules[modules.length - 1].title,
    },
  ];

  const article = /^[aeiou]/i.test(level) ? "An" : "A";
  const attachedNote =
    attachments.length > 0
      ? ` Tailored to ${attachments.length} attached file${attachments.length === 1 ? "" : "s"}: ${attachments
          .slice(0, 3)
          .map((a) => a.name)
          .join(", ")}${attachments.length > 3 ? " and more" : ""}.`
      : "";
  const summary = goal
    ? `${article} ${level} course on ${topic}, built around your goal: ${goal}. Starts from the mental models, builds to a working implementation, and finishes on the failure modes.${attachedNote}`
    : `${article} ${level} course on ${topic}. Starts from the mental models, builds to a working implementation, and finishes on the failure modes that bite in production.${attachedNote}`;

  return {
    summary,
    estMinutes,
    coverStyle: pick(rng, ["grid", "circuit", "wave"] as const),
    modules,
    sources,
    prerequisites,
    questions,
  };
}