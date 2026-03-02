"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { AdminBootstrapArtistResponse } from "@/lib/adminTypes";

type AdminBootstrapFormProps = {
  defaultFAPPublicBaseURL: string;
  defaultLNBitsBaseURL: string;
};

function parseErrorBody(payload: string): string {
  const trimmed = payload.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.error === "string") {
      return parsed.error;
    }
    if (parsed.error && typeof parsed.error === "object") {
      const nested = parsed.error as Record<string, unknown>;
      if (typeof nested.message === "string") {
        return nested.message;
      }
      if (typeof nested.code === "string") {
        return nested.code;
      }
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function toHandleSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

export function AdminBootstrapForm({
  defaultFAPPublicBaseURL,
  defaultLNBitsBaseURL
}: AdminBootstrapFormProps) {
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [artistId, setArtistId] = useState("");
  const [payeeId, setPayeeId] = useState("");
  const [pubkeyHex, setPubkeyHex] = useState("");
  const [lnbitsBaseUrl, setLNBitsBaseURL] = useState(defaultLNBitsBaseURL);
  const [lnbitsInvoiceKey, setLNBitsInvoiceKey] = useState("");
  const [lnbitsReadKey, setLNBitsReadKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<AdminBootstrapArtistResponse | null>(null);

  const suggestedHandle = useMemo(() => toHandleSlug(handle || displayName), [displayName, handle]);

  useEffect(() => {
    if (!handle.trim() && suggestedHandle) {
      setHandle(suggestedHandle);
    }
  }, [suggestedHandle, handle]);

  const handleSubmit = async (): Promise<void> => {
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/admin/bootstrap/artist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artistId,
          payeeId,
          handle,
          displayName,
          pubkeyHex,
          lnbitsBaseUrl,
          lnbitsInvoiceKey,
          lnbitsReadKey
        })
      });
      const payload = await response.text();
      if (!response.ok) {
        throw new Error(parseErrorBody(payload) || `bootstrap failed (${response.status})`);
      }
      const parsed = JSON.parse(payload) as AdminBootstrapArtistResponse;
      setSuccess(parsed);
      setArtistId(parsed.artist_id);
      setPayeeId(parsed.payee_id);
      setLNBitsInvoiceKey("");
      setLNBitsReadKey("");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("bootstrap failed");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-200">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-100">Bootstrap Artist + Payee</h2>
        <p className="text-xs text-slate-400">
          Dev-only flow that creates a catalog artist, creates a FAP payee with LNbits keys, and
          stores the catalog payee mapping in one step.
        </p>
      </div>

      {errorMessage ? (
        <p className="rounded bg-rose-500/10 p-2 text-rose-300">{errorMessage}</p>
      ) : null}
      {success ? (
        <p className="rounded bg-emerald-500/10 p-2 text-emerald-300">
          Bootstrapped artist <span className="font-mono">{success.artist_id}</span> and payee{" "}
          <span className="font-mono">{success.payee_id}</span>. Continue in{" "}
          <Link
            href={`/admin/upload?artist_id=${encodeURIComponent(success.artist_id)}&payee_id=${encodeURIComponent(success.payee_id)}`}
            className="underline"
          >
            /admin/upload
          </Link>
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-slate-400">handle</span>
          <input
            value={handle}
            onChange={(event) => setHandle(toHandleSlug(event.target.value))}
            placeholder="artist_handle"
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">display_name</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Artist Name"
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">artist_id (optional)</span>
          <input
            value={artistId}
            onChange={(event) => setArtistId(event.target.value)}
            placeholder="auto: ar_<hash>"
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">payee_id (optional)</span>
          <input
            value={payeeId}
            onChange={(event) => setPayeeId(event.target.value)}
            placeholder="auto: pe_<hash>"
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1 md:col-span-2">
          <span className="text-xs text-slate-400">pubkey_hex (optional)</span>
          <input
            value={pubkeyHex}
            onChange={(event) => setPubkeyHex(event.target.value)}
            placeholder="auto: sha256(handle)"
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">fap_public_base_url (readonly)</span>
          <input
            readOnly
            value={defaultFAPPublicBaseURL}
            className="h-10 w-full cursor-not-allowed rounded border border-slate-700 bg-slate-900/40 px-3 text-slate-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">lnbits_base_url</span>
          <input
            value={lnbitsBaseUrl}
            onChange={(event) => setLNBitsBaseURL(event.target.value)}
            placeholder="http://lnbits:5000"
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">lnbits_invoice_key</span>
          <input
            type="password"
            value={lnbitsInvoiceKey}
            onChange={(event) => setLNBitsInvoiceKey(event.target.value)}
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">lnbits_read_key</span>
          <input
            type="password"
            value={lnbitsReadKey}
            onChange={(event) => setLNBitsReadKey(event.target.value)}
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={isSubmitting}
        className="h-10 rounded bg-cyan-400 px-4 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? "Bootstrapping..." : "Bootstrap All"}
      </button>
    </section>
  );
}
