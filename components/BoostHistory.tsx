"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoostListResponse, BoostStatus } from "@/lib/boostTypes";

type BoostHistoryProps = {
  assetId: string;
};

const statusClassByValue: Record<BoostStatus, string> = {
  pending: "bg-amber-400/20 text-amber-300",
  paid: "bg-emerald-400/20 text-emerald-300",
  expired: "bg-slate-400/20 text-slate-300",
  failed: "bg-rose-400/20 text-rose-300"
};

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return "Unexpected error";
}

function parseErrorBody(payload: string): string {
  const trimmed = payload.trim();
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

function formatUnix(unixSeconds: number | null): string {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return "-";
  }
  return new Date(unixSeconds * 1000).toLocaleString();
}

export function BoostHistory({ assetId }: BoostHistoryProps) {
  const [items, setItems] = useState<BoostListResponse["items"]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const hasPending = useMemo<boolean>(() => items.some((item) => item.status === "pending"), [items]);

  const fetchHistory = useCallback(
    async (options?: { silent?: boolean }): Promise<void> => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setLoading(true);
      }
      setRefreshing(silent);
      setError(null);
      try {
        const response = await fetch(`/api/boost/list?assetId=${encodeURIComponent(assetId)}&limit=20`, {
          method: "GET",
          cache: "no-store"
        });
        const body = await response.text();
        if (!response.ok) {
          throw new Error(parseErrorBody(body) || `history fetch failed (${response.status})`);
        }
        const parsed = JSON.parse(body) as BoostListResponse;
        setItems(Array.isArray(parsed.items) ? parsed.items : []);
      } catch (err: unknown) {
        setError(toErrorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [assetId]
  );

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!hasPending) {
      return;
    }
    const interval = window.setInterval(() => {
      void fetchHistory({ silent: true });
    }, 10_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [fetchHistory, hasPending]);

  const whereItWent = items[0]?.payee_id ?? "-";

  return (
    <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-200">
      <div className="flex items-center justify-between">
        <p className="text-base font-medium">Boost history</p>
        <button
          type="button"
          className="rounded-md border border-slate-600 px-3 py-1 text-xs transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => {
            void fetchHistory();
          }}
          disabled={loading || refreshing}
        >
          {loading || refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <p className="text-xs text-slate-400">Where it went: payee_id {whereItWent}</p>

      {loading ? <p className="text-slate-400">Loading boost history...</p> : null}
      {error ? <p className="text-rose-300">{error}</p> : null}

      {!loading && !error && items.length === 0 ? (
        <p className="text-slate-400">No boosts recorded for this asset yet.</p>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.boost_id} className="rounded border border-slate-700 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span>{Math.trunc(item.amount_msat / 1000)} sats</span>
                <span className={`rounded-full px-2 py-0.5 text-xs uppercase ${statusClassByValue[item.status]}`}>
                  {item.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">created: {formatUnix(item.created_at)}</p>
              <p className="text-xs text-slate-400">paid: {formatUnix(item.paid_at)}</p>
              <p className="text-xs text-slate-400">payee_id: {item.payee_id}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
