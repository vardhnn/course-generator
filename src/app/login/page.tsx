"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { safeNextPath } from "@/lib/validation";

type Mode = "login" | "signup";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [mode, setMode] = useState<Mode>(search.get("mode") === "signup" ? "signup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Catch a typo before the round trip, while the field is still focused.
    if (mode === "signup" && password !== confirm) {
      setError("Passwords don't match");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "signup" ? { name, email, password } : { email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      // Only same-origin paths — "//host" and "/\host" are protocol-
      // relative and would bounce a fresh session off-site.
      router.push(safeNextPath(search.get("next")));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    // Keep the URL in sync so the account-creation form is a real,
    // reloadable address (/login?mode=signup), not just transient state.
    router.replace(`/login?mode=${m}`, { scroll: false });
  };

  return (
    <div className="flex flex-col items-center py-10">
      <div className="panel rise w-full max-w-md p-6">
        <p className="meta">Studio access</p>
        <h1 className="font-display mt-1 text-3xl font-semibold">
          {mode === "login" ? "Welcome back." : "Set up your desk."}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          {mode === "login"
            ? "Sign in to keep your courses, progress and assessments together."
            : "An account keeps your courses and progress in one place."}
        </p>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
          {mode === "signup" && (
            <label className="labelled">
              <span className="meta">Name</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="Ada Lovelace"
                maxLength={80}
              />
            </label>
          )}

          <label className="labelled">
            <span className="meta">Email</span>
            <input
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>

          <label className="labelled">
            <span className="meta">Password</span>
            <input
              className="input"
              type="password"
              required
              minLength={mode === "signup" ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
            />
          </label>

          {mode === "signup" && (
            <label className="labelled">
              <span className="meta">Confirm password</span>
              <input
                className="input"
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                placeholder="Type it once more"
              />
            </label>
          )}

          {error && (
            <p role="alert" className="border-2 border-bad bg-bad/10 px-3 py-2 text-xs text-bad">
              {error}
            </p>
          )}

          <button className="btn btn-accent" type="submit" disabled={busy}>
            {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-sm text-ink-soft">
          {mode === "login" ? "No account yet? " : "Already have one? "}
          <button
            type="button"
            onClick={() => switchTo(mode === "login" ? "signup" : "login")}
            className="underline underline-offset-4 hover:text-ink"
          >
            {mode === "login" ? "Create one" : "Sign in"}
          </button>
        </p>
      </div>

      <Link href="/" className="meta mt-6 underline-offset-4 hover:underline">
        ← Back to the studio home
      </Link>
    </div>
  );
}
