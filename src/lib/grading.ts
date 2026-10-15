import type { QuestionKind } from "@/lib/validation";

export interface GradeInput {
  kind: QuestionKind;
  answer: string;
  options: string[];
  response: string;
  points: number;
}

export interface GradeResult {
  correct: boolean;
  score: number;
  feedback: string;
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Content words worth requiring in a short answer. */
function keywords(answer: string): string[] {
  const stop = new Set([
    "the","a","an","is","are","was","were","it","its","this","that","to","of","in","on",
    "for","and","or","but","be","been","has","have","had","not","no","you","your","if",
    "because","so","as","by","with","from","at","than","then","there","their","they",
  ]);
  return [...new Set(normalise(answer).split(" ").filter((w) => w.length > 3 && !stop.has(w)))];
}

/** Compare the learner's code against the reference by token overlap. */
function codeTokens(code: string): Set<string> {
  const stripped = code
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(["'`])((?:\\.|(?!\1).)*)\1/g, (m) => ` ${m.slice(1, -1)} `);
  return new Set(
    stripped
      .split(/[^A-Za-z0-9_$]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1),
  );
}

const CODE_THRESHOLD = 0.6;
const SHORT_ANSWER_THRESHOLD = 0.5;

export function grade(input: GradeInput): GradeResult {
  const points = input.points;

  switch (input.kind) {
    case "mcq":
    case "truefalse": {
      const correct = normalise(input.response) === normalise(input.answer);
      return {
        correct,
        score: correct ? points : 0,
        feedback: correct
          ? "Correct."
          : `Not quite — the expected answer is: ${input.answer}`,
      };
    }

    case "shortanswer": {
      const expected = keywords(input.answer);
      const given = new Set(normalise(input.response).split(" "));
      const hit = expected.filter((k) => given.has(k));
      const ratio = expected.length === 0 ? 1 : hit.length / expected.length;
      // A good short answer names the concept and the consequence; it does not
      // have to reproduce every content word of the model answer.
      const correct = ratio >= SHORT_ANSWER_THRESHOLD;
      const missing = expected.filter((k) => !given.has(k));
      return {
        correct,
        score: Math.round(ratio * points * 100) / 100,
        feedback: correct
          ? "Good — that captures the key idea."
          : `Partial. ${
              missing.length
                ? `Consider: ${missing.slice(0, 4).join(", ")}.`
                : "Reword and try again."
            } Model answer: ${input.answer}`,
      };
    }

    case "code": {
      const expected = codeTokens(input.answer);
      const given = codeTokens(input.response);
      if (expected.size === 0) {
        return { correct: false, score: 0, feedback: "No reference solution to compare against." };
      }
      let overlap = 0;
      for (const token of expected) if (given.has(token)) overlap++;
      const ratio = overlap / expected.size;
      const correct = ratio >= CODE_THRESHOLD;
      const missing = [...expected].filter((t) => !given.has(t)).slice(0, 6);
      return {
        correct,
        score: Math.round(ratio * points * 100) / 100,
        feedback: correct
          ? `Matches the reference behaviour (${Math.round(ratio * 100)}% overlap).`
          : `${Math.round(ratio * 100)}% overlap with the reference.${
              missing.length ? ` Missing: ${missing.join(", ")}.` : ""
            }`,
      };
    }

    default:
      return { correct: false, score: 0, feedback: "Unknown question type." };
  }
}