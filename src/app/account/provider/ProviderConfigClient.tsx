"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Key, Loader2, Pencil, Plus, Radio, Shield, Trash2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PROVIDER_PRESETS, presetFor } from "@/lib/ai/catalog";
import { BackToDashboard } from "@/components/back-to-dashboard";

export interface ProviderRow {
  id: string;
  type: string;
  model: string;
  hasKey: boolean;
  baseUrl: string;
  active: boolean;
}

interface Listing {
  providers: ProviderRow[];
  activeId: string | null;
}

/** Default endpoints, used to decide whether a field still holds a preset value. */
const KNOWN_BASE_URLS = PROVIDER_PRESETS.map((p) => p.baseUrl).filter(Boolean);
const KNOWN_MODELS = new Set(PROVIDER_PRESETS.map((p) => p.model).filter(Boolean));

type FormState = { type: string; model: string; key: string; baseUrl: string };

const EMPTY_FORM: FormState = { type: "openai", model: "", key: "", baseUrl: "" };

export function ProviderConfigClient({
  user,
  providers: initial,
}: {
  user: { id: string; email: string; name: string };
  providers: ProviderRow[];
}) {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderRow[]>(initial);
  // null = creating a new provider; an id = editing that row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);
  // Per-row outcome of "Test connection": latency when it answered, the
  // provider's own error message when it did not.
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [removing, setRemoving] = useState<ProviderRow | null>(null);

  const preset = presetFor(form.type);
  const editing = editingId ? providers.find((p) => p.id === editingId) ?? null : null;

  function applyListing(data: Listing) {
    setProviders(data.providers);
    router.refresh();
  }

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setResult(null);
  }

  function startEdit(row: ProviderRow) {
    // The stored key never reaches the browser; an empty key field on save
    // means "keep the key that is already stored".
    setEditingId(row.id);
    setForm({ type: row.type, model: row.model, key: "", baseUrl: row.baseUrl });
    setResult(null);
    if (typeof document !== "undefined") {
      document.getElementById("provider-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function pickType(next: string) {
    const nextPreset = presetFor(next);
    setForm((f) => {
      // Only reset fields the user has not customized, so switching provider
      // never silently discards a typed endpoint or model id.
      const baseUrl = !f.baseUrl.trim() || KNOWN_BASE_URLS.includes(f.baseUrl.trim())
        ? (nextPreset?.baseUrl ?? "")
        : f.baseUrl;
      const model = !f.model.trim() || KNOWN_MODELS.has(f.model.trim())
        ? (nextPreset?.model ?? "")
        : f.model;
      return { ...f, type: next, baseUrl, model };
    });
    setResult(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.model.trim()) return;
    setResult(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        editingId ? `/api/account/provider/${editingId}` : "/api/account/provider",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: form.type,
            model: form.model.trim(),
            key: form.key.trim(),
            baseUrl: form.baseUrl.trim(),
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as Listing & { error?: string };
      if (res.ok && data.providers) {
        applyListing(data);
        setResult({
          ok: true,
          detail: editingId ? "Provider updated." : "Provider saved. Select it to start using it.",
        });
        setEditingId(null);
        setForm(EMPTY_FORM);
      } else {
        setResult({ ok: false, detail: data.error ?? "Could not save the provider." });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function activate(row: ProviderRow) {
    setResult(null);
    setPendingId(row.id);
    try {
      const res = await fetch(`/api/account/provider/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activate: true }),
      });
      const data = (await res.json().catch(() => ({}))) as Listing & { error?: string };
      if (res.ok && data.providers) {
        applyListing(data);
        setResult({ ok: true, detail: `Now using ${presetFor(row.type)?.label ?? row.type} · ${row.model}.` });
      } else {
        setResult({ ok: false, detail: data.error ?? "Could not switch provider." });
      }
    } finally {
      setPendingId(null);
    }
  }

  async function test(row: ProviderRow) {
    setResult(null);
    setPendingId(row.id);
    try {
      const res = await fetch(`/api/account/provider/${row.id}/test`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        latencyMs?: number;
        error?: string;
        model?: string;
      };
      if (res.ok && data.ok) {
        setTestResults((prev) => ({
          ...prev,
          [row.id]: {
            ok: true,
            detail: `Answered in ${(data.latencyMs! / 1000).toFixed(1)}s · ${data.model ?? row.model}`,
          },
        }));
      } else {
        setTestResults((prev) => ({
          ...prev,
          [row.id]: { ok: false, detail: data.error ?? `Test failed (${res.status})` },
        }));
      }
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [row.id]: { ok: false, detail: e instanceof Error ? e.message : "Test failed" },
      }));
    } finally {
      setPendingId(null);
    }
  }

  async function remove(row: ProviderRow) {
    setResult(null);
    setPendingId(row.id);
    try {
      const res = await fetch(`/api/account/provider/${row.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as Listing & { error?: string };
      if (res.ok && data.providers) {
        applyListing(data);
        setResult({ ok: true, detail: "Provider deleted." });
        if (editingId === row.id) startCreate();
      } else {
        setResult({ ok: false, detail: data.error ?? "Could not delete the provider." });
      }
    } finally {
      setPendingId(null);
      setRemoving(null);
    }
  }

  const activeRow = providers.find((p) => p.active) ?? null;

  return (
    <div className="flex flex-col gap-8 pb-8">
      <BackToDashboard />

      <header className="rise">
        <p className="meta">Account</p>
        <h1 className="font-display mt-1 text-3xl font-semibold">Your providers</h1>
        <p className="mt-2 max-w-lg text-sm text-ink-soft">
          Save as many as you like, pick the one courses generate with, and edit or remove any of
          them. Keys are stored on the server and never sent to the browser.
        </p>
      </header>

      {result && (
        <div
          role="status"
          className={`flex items-center gap-2 border-2 p-4 text-sm ${
            result.ok ? "border-ok/40 bg-ok/10 text-ok" : "border-bad/40 bg-bad/10 text-bad"
          }`}
        >
          {result.ok ? <Check className="size-4 shrink-0" aria-hidden /> : <Key className="size-4 shrink-0" aria-hidden />}
          {result.detail}
        </div>
      )}

      <section className="panel rise p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="meta">Saved providers</p>
            <p className="font-display mt-1 text-xl font-semibold">
              {providers.length === 0
                ? "None yet"
                : activeRow
                  ? `${presetFor(activeRow.type)?.label ?? activeRow.type} · ${activeRow.model} is active`
                  : `${providers.length} saved`}
            </p>
            <p className="mt-1 max-w-lg text-sm text-ink-soft">
              {activeRow
                ? "Courses generate with the active provider. Use, edit or delete any row below."
                : providers.length > 0
                  ? "No provider selected — courses use the deterministic local generator."
                  : "Add a configuration below to generate with your own model."}
            </p>
          </div>
          <span className={activeRow ? "chip chip-accent" : "chip"}>
            {activeRow ? "live" : "simulated"}
          </span>
        </div>

        {providers.length > 0 && (
          <ul className="mt-5 flex flex-col gap-3">
            {providers.map((row) => {
              const rowPreset = presetFor(row.type);
              const busy = pendingId === row.id;
              return (
                <li
                  key={row.id}
                  className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-2 p-4 ${
                    row.active ? "border-accent/50 bg-accent-wash/30" : "border-line-soft"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="truncate">
                        {rowPreset?.label ?? row.type} · {row.model}
                      </span>
                      {row.active && <span className="chip chip-accent">active</span>}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-soft">
                      {row.baseUrl || "default endpoint"} ·{" "}
                      {row.hasKey ? "key stored" : "no key"}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {!row.active && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void activate(row)}
                        disabled={busy || submitting}
                        aria-label={`Use ${rowPreset?.label ?? row.type} ${row.model}`}
                      >
                        <Radio className="size-3.5" aria-hidden />
                        Use
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void test(row)}
                      disabled={busy || submitting}
                      aria-label={`Test connection to ${rowPreset?.label ?? row.type} ${row.model}`}
                    >
                      {busy && testResults[row.id] === undefined ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Zap className="size-3.5" aria-hidden />
                      )}
                      Test
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => startEdit(row)}
                      disabled={busy || submitting}
                      aria-label={`Edit ${rowPreset?.label ?? row.type} ${row.model}`}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setRemoving(row)}
                      disabled={busy || submitting}
                      aria-label={`Delete ${rowPreset?.label ?? row.type} ${row.model}`}
                    >
                      {busy && removing?.id === row.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="size-3.5" aria-hidden />
                      )}
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* The outcome of the last connection test, under its own row. */}
        {Object.entries(testResults).length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {Object.entries(testResults).map(([id, t]) => {
              const row = providers.find((p) => p.id === id);
              if (!row) return null;
              return (
                <li
                  key={id}
                  role="status"
                  className={`text-xs ${t.ok ? "text-ok" : "text-bad"}`}
                >
                  {presetFor(row.type)?.label ?? row.type} · {row.model}: {t.detail}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section id="provider-form" className="panel rise p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="meta">{editing ? "Edit provider" : "Add a provider"}</p>
            <p className="font-display mt-1 text-xl font-semibold">
              {editing
                ? `${presetFor(editing.type)?.label ?? editing.type} · ${editing.model}`
                : "New configuration"}
            </p>
          </div>
          {editing && (
            <Button type="button" variant="ghost" size="sm" onClick={startCreate} disabled={submitting}>
              <X className="size-3.5" aria-hidden />
              Stop editing
            </Button>
          )}
        </div>

        <form
          className="mt-5 flex flex-col gap-4"
          onSubmit={(e) => {
            void save(e);
          }}
        >
          <label className="labelled">
            <span className="meta">Provider</span>
            <select
              className="input"
              value={form.type}
              onChange={(e) => pickType(e.target.value)}
              disabled={submitting}
            >
              {(["cloud", "local"] as const).map((group) => (
                <optgroup key={group} label={group === "cloud" ? "Cloud providers" : "Local providers"}>
                  {PROVIDER_PRESETS.filter((p) => p.group === group).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink-soft">{preset?.help}</p>
          </label>

          <label className="labelled">
            <span className="meta">Model</span>
            <input
              className="input"
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              placeholder={preset?.model || "model id"}
              required
              maxLength={200}
              disabled={submitting}
            />
          </label>

          <label className="labelled">
            <span className="meta">
              API key
              {editing?.hasKey && <span className="ml-1 text-ink-faint">(stored — leave blank to keep)</span>}
            </span>
            <input
              className="input"
              type="password"
              value={form.key}
              onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
              placeholder={editing?.hasKey ? "••••••••" : preset?.keyPlaceholder || "optional"}
              maxLength={4096}
              autoComplete="off"
              disabled={submitting}
            />
            <p className="mt-1 text-xs text-ink-soft">
              {preset?.keyOptional
                ? "Blank is fine — this kind of server usually runs without a key."
                : "Stored server-side, used only for your courses and tutoring."}
            </p>
          </label>

          {preset && preset.protocol !== "gemini" && (
            <label className="labelled">
              <span className="meta">
                Base URL
                {preset.id === "custom" ? (
                  <span className="ml-1 text-ink-faint">(required)</span>
                ) : (
                  <span className="ml-1 text-ink-faint">(optional)</span>
                )}
              </span>
              <input
                className="input"
                type="url"
                value={form.baseUrl}
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                placeholder={preset.baseUrl || "https://example.com/v1"}
                maxLength={4096}
                required={preset.id === "custom"}
                disabled={submitting}
              />
              <p className="mt-1 text-xs text-ink-soft">
                {preset.protocol === "ollama"
                  ? "Ollama's native API, usually http://localhost:11434 — no /v1 suffix needed."
                  : preset.id === "custom"
                    ? "Any OpenAI-compatible endpoint, usually ending in /v1."
                    : "Defaults to the provider's own endpoint; override for a proxy or a self-hosted gateway."}
              </p>
            </label>
          )}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={submitting || !form.model.trim()}>
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
              {editing ? "Save changes" : "Add provider"}
            </Button>
          </div>
        </form>
      </section>

      <section className="panel rise p-5">
        <div className="flex items-start gap-3">
          <Shield className="mt-0.5 size-5 shrink-0 text-ink-soft" aria-hidden />
          <div>
            <p className="meta">Security</p>
            <p className="mt-1 text-sm text-ink-soft">
              Course generation and tutoring call the active provider from the server only — your
              key never reaches the browser, logs, or the course records. To revoke access, delete
              the provider here or rotate the key at the provider itself.
            </p>
          </div>
        </div>
      </section>

      {/* Themed confirmation for a destructive row action — the same dialog
          the course delete uses, instead of the browser's native one. */}
      <ConfirmDialog
        open={removing !== null}
        title={`Delete "${removing ? (presetFor(removing.type)?.label ?? removing.type) : ""} · ${removing?.model ?? ""}"?`}
        body={
          removing?.active
            ? "This is your active provider — another saved provider becomes active, or courses fall back to the local generator. It cannot be undone."
            : "This removes the stored configuration and its key from the server. It cannot be undone."
        }
        confirmLabel="Delete provider"
        cancelLabel="Keep it"
        busy={pendingId !== null}
        onConfirm={() => removing && void remove(removing)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
