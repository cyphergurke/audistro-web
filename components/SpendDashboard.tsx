"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LedgerEntry, LedgerListResponse, SpendSummaryResponse } from "@/lib/types";

type WindowKey = "7d" | "30d";

const windowSeconds: Record<WindowKey, number> = {
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return "Unexpected error";
}

function parseErrorPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.error === "string") {
        return record.error;
      }
      if (typeof record.message === "string") {
        return record.message;
      }
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store"
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(parseErrorPayload(text) || `HTTP ${response.status}`);
  }
  return JSON.parse(text) as T;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

function unixTimestampToLocal(unixSeconds: number | null | undefined): string {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return "-";
  }
  return new Date(unixSeconds * 1000).toLocaleString();
}

function formatMSat(msat: number): string {
  return `${msat.toLocaleString()} msat`;
}

function formatSats(msat: number): string {
  return `${Math.trunc(msat / 1000).toLocaleString()} sats`;
}

export function SpendDashboard() {
  const [windowKey, setWindowKey] = useState<WindowKey>("30d");
  const [summary, setSummary] = useState<SpendSummaryResponse | null>(null);
  const [recentEntries, setRecentEntries] = useState<LedgerEntry[]>([]);
  const [state, setState] = useState<LoadState>({ kind: "idle" });

  const windowRange = useMemo(() => {
    const to = unixNow();
    return {
      from: to - windowSeconds[windowKey],
      to
    };
  }, [windowKey]);

  const load = async (): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const summaryURL = `/api/me/spend-summary?from=${windowRange.from}&to=${windowRange.to}`;
      const ledgerURL = `/api/me/ledger?status=paid&limit=20&from=${windowRange.from}&to=${windowRange.to}`;
      const [summaryPayload, ledgerPayload] = await Promise.all([
        fetchJSON<SpendSummaryResponse>(summaryURL),
        fetchJSON<LedgerListResponse>(ledgerURL)
      ]);
      setSummary(summaryPayload);
      setRecentEntries(ledgerPayload.items);
      setState({ kind: "ready" });
    } catch (err: unknown) {
      setSummary(null);
      setRecentEntries([]);
      setState({
        kind: "error",
        message: toErrorMessage(err)
      });
    }
  };

  useEffect(() => {
    void load();
  }, [windowKey]);

  return (
    <section className="space-y-4 text-sm text-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setWindowKey("7d")}
          className={`rounded-md border px-3 py-1 transition ${
            windowKey === "7d" ? "border-cyan-300 text-cyan-200" : "border-slate-600"
          }`}
        >
          Last 7 days
        </button>
        <button
          type="button"
          onClick={() => setWindowKey("30d")}
          className={`rounded-md border px-3 py-1 transition ${
            windowKey === "30d" ? "border-cyan-300 text-cyan-200" : "border-slate-600"
          }`}
        >
          Last 30 days
        </button>
        <button
          type="button"
          onClick={() => {
            void load();
          }}
          className="rounded-md border border-slate-600 px-3 py-1 transition hover:border-cyan-300"
          disabled={state.kind === "loading"}
        >
          {state.kind === "loading" ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <p className="text-xs text-slate-400">
        Window: {unixTimestampToLocal(windowRange.from)} - {unixTimestampToLocal(windowRange.to)}
      </p>

      {state.kind === "error" ? (
        <p className="rounded-md border border-rose-500/50 bg-rose-950/40 p-3 text-rose-200">
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Access Total</p>
          <p className="mt-1 text-lg font-semibold">
            {summary ? formatSats(summary.totals.total_paid_msat_access) : "-"}
          </p>
          <p className="text-xs text-slate-400">
            {summary ? formatMSat(summary.totals.total_paid_msat_access) : "-"}
          </p>
        </article>
        <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Boost Total</p>
          <p className="mt-1 text-lg font-semibold">
            {summary ? formatSats(summary.totals.total_paid_msat_boost) : "-"}
          </p>
          <p className="text-xs text-slate-400">
            {summary ? formatMSat(summary.totals.total_paid_msat_boost) : "-"}
          </p>
        </article>
        <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Total Paid</p>
          <p className="mt-1 text-lg font-semibold">
            {summary ? formatSats(summary.totals.total_paid_msat_all) : "-"}
          </p>
          <p className="text-xs text-slate-400">
            {summary ? formatMSat(summary.totals.total_paid_msat_all) : "-"}
          </p>
        </article>
      </div>

      <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <p className="font-medium">Top Assets</p>
        {!summary || summary.top_assets.length === 0 ? (
          <p className="mt-2 text-slate-400">No paid asset entries in this window.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {summary.top_assets.map((item) => (
              <li key={item.asset_id} className="rounded border border-slate-700 p-2">
                <p>
                  <Link
                    href={`/asset/${encodeURIComponent(item.asset_id)}`}
                    className="text-cyan-300 underline-offset-2 hover:underline"
                  >
                    {item.title || item.asset_id}
                  </Link>
                </p>
                <p className="text-xs text-slate-400">
                  asset_id={item.asset_id}
                  {item.artist_handle ? ` | artist=@${item.artist_handle}` : ""}
                  {item.artist_display_name ? ` (${item.artist_display_name})` : ""}
                </p>
                <p className="text-xs text-slate-400">
                  {formatSats(item.amount_msat)} ({formatMSat(item.amount_msat)})
                </p>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <p className="font-medium">Top Payees</p>
        {!summary || summary.top_payees.length === 0 ? (
          <p className="mt-2 text-slate-400">No paid payee entries in this window.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {summary.top_payees.map((item) => (
              <li key={item.payee_id} className="rounded border border-slate-700 p-2">
                <p>{item.payee_id}</p>
                {(item.artist_handle || item.artist_display_name) && (
                  <p className="text-xs text-slate-400">
                    {item.artist_handle ? `@${item.artist_handle}` : ""}
                    {item.artist_display_name ? ` ${item.artist_display_name}` : ""}
                  </p>
                )}
                <p className="text-xs text-slate-400">
                  {formatSats(item.amount_msat)} ({formatMSat(item.amount_msat)})
                </p>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <p className="font-medium">Recent Ledger Entries</p>
        {recentEntries.length === 0 ? (
          <p className="mt-2 text-slate-400">No entries.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recentEntries.map((item) => (
              <li key={item.entry_id} className="rounded border border-slate-700 p-2">
                <p>
                  {item.kind} | {item.status}
                </p>
                <p className="text-xs text-slate-400">
                  {item.asset_id ? (
                    <>
                      asset:{" "}
                      <Link
                        href={`/asset/${encodeURIComponent(item.asset_id)}`}
                        className="text-cyan-300 underline-offset-2 hover:underline"
                      >
                        {item.asset_id}
                      </Link>
                    </>
                  ) : (
                    "asset: -"
                  )}
                  {" | "}payee: {item.payee_id}
                </p>
                <p className="text-xs text-slate-400">
                  created: {unixTimestampToLocal(item.created_at)} | paid:{" "}
                  {unixTimestampToLocal(item.paid_at)}
                </p>
                <p className="text-xs text-slate-400">
                  {formatSats(item.amount_msat)} ({formatMSat(item.amount_msat)})
                </p>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
