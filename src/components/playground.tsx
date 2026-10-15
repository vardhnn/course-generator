"use client";

import { useMemo, useRef, useState } from "react";

type RunResult = { ok: boolean; output: string; ms: number };

const TIMEOUT_MS = 3000;

/**
 * Runs the learner's JavaScript inside a Worker so an infinite loop cannot
 * freeze the page — the worker is terminated on a timeout.
 */
function runInWorker(rawCode: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    // `new Function` bodies cannot contain module syntax, so strip exports
    // before evaluating learner code written as a module.
    const code = rawCode.replace(/^[ \t]*export\s+(default\s+)?/gm, "");
    const blob = new Blob(
      [
        `self.onmessage = function(){
  var logs = [];
  var console = { log: function(){
    var a = Array.prototype.slice.call(arguments);
    logs.push(a.map(function(x){ try { return typeof x === 'string' ? x : JSON.stringify(x); } catch(e){ return String(x); } }).join(' '));
  } };
  try {
    var result = (new Function('console', ${JSON.stringify(code)}))(console);
    if (result !== undefined) logs.push('→ ' + (typeof result === 'string' ? result : JSON.stringify(result)));
    self.postMessage({ ok: true, output: logs.join('\\n') });
  } catch (err) {
    logs.push('✕ ' + (err && err.message ? err.message : String(err)));
    self.postMessage({ ok: false, output: logs.join('\\n') });
  }
};`,
      ],
      { type: "application/javascript" },
    );

    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    const finish = (result: RunResult) => {
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        output: `✕ Timed out after ${TIMEOUT_MS}ms — is there an infinite loop?`,
        ms: Math.round(performance.now() - started),
      });
    }, TIMEOUT_MS);

    worker.onmessage = (e: MessageEvent<{ ok: boolean; output: string }>) => {
      clearTimeout(timer);
      finish({ ok: e.data.ok, output: e.data.output, ms: Math.round(performance.now() - started) });
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      finish({ ok: false, output: `✕ ${e.message}`, ms: Math.round(performance.now() - started) });
    };

    worker.postMessage(code);
  });
}

export function Playground({
  lessonId,
  starter,
  solution,
}: {
  lessonId: string;
  starter: string;
  solution: string;
}) {
  const [code, setCode] = useState(starter);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dirty = useMemo(() => code !== starter, [code, starter]);

  async function run() {
    setRunning(true);
    setAttempts((n) => n + 1);
    const outcome = await runInWorker(code);
    setResult(outcome);
    setRunning(false);
  }

  function insertSnippet(snippet: string) {
    const el = textareaRef.current;
    if (!el) {
      setCode((c) => `${c}\n${snippet}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = `${code.slice(0, start)}${snippet}${code.slice(end)}`;
    setCode(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + snippet.length;
    });
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-line bg-paper-2 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="meta">Playground</span>
          <span className="chip">JavaScript</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => setCode(starter)} disabled={running || !dirty}>
            Reset
          </button>
          <button className="btn btn-ghost" onClick={() => setRevealed((v) => !v)}>
            {revealed ? "Hide solution" : "Show solution"}
          </button>
          <button className="btn btn-accent" onClick={() => void run()} disabled={running}>
            {running ? "Running…" : "Run"}
          </button>
        </div>
      </div>

      <div className="grid gap-0 md:grid-cols-2">
        <div className="border-b-2 border-line md:border-b-0 md:border-r-2">
          <label className="sr-only" htmlFor={`code-${lessonId}`}>
            Code editor
          </label>
          <textarea
            id={`code-${lessonId}`}
            ref={textareaRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            className="min-h-[22rem] w-full resize-y bg-surface-2 p-4 font-mono text-[0.8125rem] leading-relaxed outline-none"
            style={{ tabSize: 2 }}
          />
        </div>

        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-2">
            <span className="meta">Output</span>
            {result && (
              <span className={result.ok ? "meta text-ok" : "meta text-bad"}>
                {result.ok ? "ok" : "error"} · {result.ms}ms
              </span>
            )}
          </div>
          <pre className="min-h-[9rem] flex-1 overflow-x-auto p-4 font-mono text-[0.8125rem] leading-relaxed">
            {result ? result.output || "(no output)" : "Press Run to execute the exercise."}
          </pre>

          <div className="flex flex-wrap gap-2 border-t border-line-soft px-4 py-3">
            <button className="btn btn-ghost" onClick={() => insertSnippet("throw new Error(")}>
              Insert throw
            </button>
            <button className="btn btn-ghost" onClick={() => insertSnippet("// your note here\n")}>
              Insert comment
            </button>
            {attempts > 0 && (
              <span className="meta self-center">
                {attempts} run{attempts === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      </div>

      {revealed && solution && (
        <div className="border-t-2 border-line bg-accent-wash/40 p-4">
          <p className="meta mb-2">Reference solution</p>
          <pre className="overflow-x-auto p-3 font-mono text-[0.8125rem] leading-relaxed">
            <code>{solution}</code>
          </pre>
        </div>
      )}
    </section>
  );
}