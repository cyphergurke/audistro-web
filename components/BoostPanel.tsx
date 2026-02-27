"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { BoostCreateResponse, BoostReceipt, BoostStatus, BoostStatusResponse } from "@/lib/boostTypes";
import { maxBoostSats } from "@/lib/boostServer";

type BoostPanelProps = {
  assetId: string;
};

const amountPresets = [100, 500, 1000];
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

function normalizeSats(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

export function BoostPanel({ assetId }: BoostPanelProps) {
  const [selectedPreset, setSelectedPreset] = useState<number>(1000);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [invoice, setInvoice] = useState<BoostCreateResponse | null>(null);
  const [status, setStatus] = useState<BoostStatus>("pending");
  const [boostError, setBoostError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [receipts, setReceipts] = useState<BoostReceipt[]>([]);

  const pollStartedAtRef = useRef<number>(0);
  const pollInFlightRef = useRef<boolean>(false);
  const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === "true" || process.env.NODE_ENV !== "production";

  const effectiveAmount = useMemo<number | null>(() => {
    const custom = normalizeSats(customAmount);
    if (custom !== null) {
      return custom;
    }
    return selectedPreset;
  }, [customAmount, selectedPreset]);

  const upsertReceipt = (next: BoostReceipt): void => {
    setReceipts((prev) => {
      const withoutCurrent = prev.filter((entry) => entry.boostId !== next.boostId);
      return [next, ...withoutCurrent].slice(0, 10);
    });
  };

  const syncStatus = (nextStatus: BoostStatus, paidAt: number | null | undefined): void => {
    setStatus(nextStatus);
    if (!invoice) {
      return;
    }
    if (nextStatus === "paid" || nextStatus === "expired" || nextStatus === "failed") {
      upsertReceipt({
        boostId: invoice.boost_id,
        assetId: invoice.asset_id,
        amountSats: Math.trunc(invoice.amount_msat / 1000),
        status: nextStatus,
        createdAt: Date.now(),
        paidAt: typeof paidAt === "number" ? paidAt : undefined
      });
    }
  };

  useEffect(() => {
    if (!invoice) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(invoice.bolt11, { margin: 1, width: 180 })
      .then((url: string) => {
        if (!cancelled) {
          setQrDataUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [invoice]);

  useEffect(() => {
    if (!invoice || status !== "pending") {
      return;
    }
    if (pollStartedAtRef.current === 0) {
      pollStartedAtRef.current = Date.now();
    }

    const timer = window.setInterval(async () => {
      if (pollInFlightRef.current) {
        return;
      }
      if (Date.now() - pollStartedAtRef.current >= 120_000) {
        setBoostError("boost polling timed out");
        syncStatus("failed", null);
        return;
      }
      pollInFlightRef.current = true;
      try {
        const response = await fetch(
          `/api/boost/${encodeURIComponent(invoice.boost_id)}?assetId=${encodeURIComponent(assetId)}`,
          {
            method: "GET",
            cache: "no-store"
          }
        );
        const body = await response.text();
        if (!response.ok) {
          throw new Error(parseErrorBody(body) || `status check failed (${response.status})`);
        }
        const parsed = JSON.parse(body) as BoostStatusResponse;
        syncStatus(parsed.status, parsed.paid_at);
      } catch (err: unknown) {
        setBoostError(toErrorMessage(err));
      } finally {
        pollInFlightRef.current = false;
      }
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [assetId, invoice, status]);

  const handleGenerateInvoice = async (): Promise<void> => {
    if (effectiveAmount === null || effectiveAmount <= 0 || effectiveAmount > maxBoostSats) {
      setBoostError(`amount must be between 1 and ${maxBoostSats} sats`);
      return;
    }

    setIsGenerating(true);
    setBoostError(null);
    pollStartedAtRef.current = 0;
    setStatus("pending");
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-boost-${assetId}`;
      const response = await fetch("/api/boost", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          assetId,
          amountSats: effectiveAmount,
          idempotencyKey
        })
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(parseErrorBody(body) || `boost create failed (${response.status})`);
      }
      const parsed = JSON.parse(body) as BoostCreateResponse;
      setInvoice(parsed);
      syncStatus(parsed.status, null);
    } catch (err: unknown) {
      setBoostError(toErrorMessage(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleMarkPaid = async (): Promise<void> => {
    if (!invoice) {
      return;
    }
    setIsMarkingPaid(true);
    setBoostError(null);
    try {
      const response = await fetch(
        `/api/boost/${encodeURIComponent(invoice.boost_id)}/mark_paid?assetId=${encodeURIComponent(assetId)}`,
        {
          method: "POST"
        }
      );
      const body = await response.text();
      if (!response.ok) {
        throw new Error(parseErrorBody(body) || `mark paid failed (${response.status})`);
      }
      const parsed = JSON.parse(body) as BoostStatusResponse;
      syncStatus(parsed.status, parsed.paid_at);
    } catch (err: unknown) {
      setBoostError(toErrorMessage(err));
    } finally {
      setIsMarkingPaid(false);
    }
  };

  const handleCopyInvoice = async (): Promise<void> => {
    if (!invoice) {
      return;
    }
    await navigator.clipboard.writeText(invoice.bolt11);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-200">
      <div className="flex items-center justify-between">
        <p className="text-base font-medium">Boost / Tip</p>
        {invoice ? (
          <span className={`rounded-full px-2 py-0.5 text-xs uppercase ${statusClassByValue[status]}`}>
            {status}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {amountPresets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`rounded-md border px-3 py-1 transition ${
              selectedPreset === preset && customAmount.trim() === ""
                ? "border-cyan-300 text-cyan-200"
                : "border-slate-600 text-slate-200 hover:border-cyan-300"
            }`}
            onClick={() => {
              setSelectedPreset(preset);
              setCustomAmount("");
            }}
          >
            {preset} sats
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="number"
          min={1}
          max={maxBoostSats}
          step={1}
          value={customAmount}
          className="h-10 flex-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
          placeholder="Custom sats"
          onChange={(event) => setCustomAmount(event.target.value)}
        />
        <button
          type="button"
          className="h-10 rounded-lg bg-cyan-400 px-4 text-sm font-medium text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleGenerateInvoice}
          disabled={isGenerating}
        >
          {isGenerating ? "Generating..." : "Generate Invoice"}
        </button>
      </div>

      {invoice ? (
        <div className="space-y-3 rounded-lg border border-slate-700 p-3">
          <p>amount: {Math.trunc(invoice.amount_msat / 1000)} sats</p>
          <p>expires_at: {invoice.expires_at}</p>
          <div className="space-y-1">
            <p className="font-medium">bolt11</p>
            <p className="break-all rounded bg-slate-950/60 p-2 text-xs">{invoice.bolt11}</p>
            <button
              type="button"
              className="rounded-md border border-slate-600 px-3 py-1 text-xs transition hover:border-cyan-300"
              onClick={handleCopyInvoice}
            >
              {copied ? "Copied" : "Copy invoice"}
            </button>
          </div>
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="Boost invoice QR code" width={180} height={180} />
          ) : (
            <p className="text-slate-400">QR unavailable</p>
          )}
          {isDevMode && status === "pending" ? (
            <button
              type="button"
              className="rounded-md border border-amber-300/60 px-3 py-1 text-xs text-amber-200 transition hover:border-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleMarkPaid}
              disabled={isMarkingPaid}
            >
              {isMarkingPaid ? "Marking..." : "Mark Paid (Dev)"}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-slate-400">Generate an invoice to start a dev boost payment.</p>
      )}

      {boostError ? <p className="text-rose-300">{boostError}</p> : null}

      {receipts.length > 0 ? (
        <div className="space-y-2">
          <p className="font-medium">Recent boost receipts (memory)</p>
          <ul className="space-y-1">
            {receipts.map((entry) => (
              <li key={entry.boostId} className="rounded border border-slate-700 p-2 text-xs">
                boost={entry.boostId} asset={entry.assetId} amount={entry.amountSats} status=
                {entry.status}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
