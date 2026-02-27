"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogArtist } from "@/lib/adminTypes";

type AdminPayeesFormProps = {
  defaultFAPPublicBaseURL: string;
  defaultLNBitsBaseURL: string;
};

type AdminPayeeCreateResponse = {
  artist_id: string;
  artist_handle: string;
  fap_payee_id: string;
  catalog_fap_payee_id: string;
  catalog_payee_id: string | null;
  fap_public_base_url: string;
};

const recentArtistsStorageKey = "audiostr_recent_artist_ids";
const recentMax = 12;

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

function loadRecentArtistIDs(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(recentArtistsStorageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, recentMax);
  } catch {
    return [];
  }
}

function saveRecentArtistIDs(values: string[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(recentArtistsStorageKey, JSON.stringify(values.slice(0, recentMax)));
}

function upsertRecentArtistID(current: string[], artistID: string): string[] {
  const next = [artistID, ...current.filter((value) => value !== artistID)].slice(0, recentMax);
  saveRecentArtistIDs(next);
  return next;
}

export function AdminPayeesForm({
  defaultFAPPublicBaseURL,
  defaultLNBitsBaseURL
}: AdminPayeesFormProps) {
  const [artists, setArtists] = useState<CatalogArtist[]>([]);
  const [artistsLoading, setArtistsLoading] = useState<boolean>(true);
  const [artistID, setArtistID] = useState<string>("");
  const [payeeID, setPayeeID] = useState<string>("");
  const [fapPayeeID, setFAPPayeeID] = useState<string>("");
  const [fapPublicBaseURL] = useState<string>(defaultFAPPublicBaseURL);
  const [lnbitsBaseURL, setLNBitsBaseURL] = useState<string>(defaultLNBitsBaseURL);
  const [lnbitsInvoiceKey, setLNBitsInvoiceKey] = useState<string>("");
  const [lnbitsReadKey, setLNBitsReadKey] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [recentArtistIDs, setRecentArtistIDs] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<AdminPayeeCreateResponse | null>(null);

  useEffect(() => {
    setRecentArtistIDs(loadRecentArtistIDs());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      setArtistsLoading(true);
      try {
        const response = await fetch("/api/admin/artists", { method: "GET", cache: "no-store" });
        const body = await response.text();
        if (!response.ok) {
          throw new Error(parseErrorBody(body) || `artist lookup failed (${response.status})`);
        }
        const parsed = JSON.parse(body) as { artists?: CatalogArtist[] };
        if (!cancelled) {
          setArtists(Array.isArray(parsed.artists) ? parsed.artists : []);
        }
      } catch (err: unknown) {
        if (!cancelled && err instanceof Error) {
          setErrorMessage(err.message);
        }
      } finally {
        if (!cancelled) {
          setArtistsLoading(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedArtist = useMemo<CatalogArtist | null>(
    () => artists.find((artist) => artist.artist_id === artistID) ?? null,
    [artists, artistID]
  );

  const handleSave = async (): Promise<void> => {
    setIsSaving(true);
    setErrorMessage(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/admin/payees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artistId: artistID,
          payeeId: payeeID,
          fapPayeeId: fapPayeeID,
          fapPublicBaseUrl: fapPublicBaseURL,
          lnbitsBaseUrl: lnbitsBaseURL,
          lnbitsInvoiceKey,
          lnbitsReadKey,
          displayName
        })
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(parseErrorBody(body) || `save failed (${response.status})`);
      }
      const parsed = JSON.parse(body) as AdminPayeeCreateResponse;
      setSuccess(parsed);
      setPayeeID(parsed.fap_payee_id);
      setFAPPayeeID(parsed.catalog_fap_payee_id);
      setLNBitsInvoiceKey("");
      setLNBitsReadKey("");
      setRecentArtistIDs((current) => upsertRecentArtistID(current, artistID));
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("Unexpected error");
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-200">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-100">Dev Admin Payees</h2>
        <p className="text-xs text-slate-400">
          Dev-only helper to seed FAP payees with LNbits keys and create catalog payee mapping.
        </p>
      </div>

      {errorMessage ? <p className="rounded bg-rose-500/10 p-2 text-rose-300">{errorMessage}</p> : null}
      {success ? (
        <p className="rounded bg-emerald-500/10 p-2 text-emerald-300">
          Saved. FAP payee={success.fap_payee_id}, catalog payee=
          {success.catalog_payee_id ?? "existing/unknown"}.
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-slate-400">artist_id</span>
          <input
            value={artistID}
            onChange={(event) => setArtistID(event.target.value)}
            placeholder="artist_xxx"
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">display_name (FAP)</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={selectedArtist?.display_name || "Artist Payee"}
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">payee_id (internal, optional)</span>
          <input
            value={payeeID}
            onChange={(event) => setPayeeID(event.target.value)}
            placeholder="auto from FAP on save"
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">fap_payee_id (catalog mapping, optional)</span>
          <input
            value={fapPayeeID}
            onChange={(event) => setFAPPayeeID(event.target.value)}
            placeholder="defaults to created FAP payee_id"
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">fap_public_base_url (readonly)</span>
          <input
            value={fapPublicBaseURL}
            readOnly
            className="h-10 w-full cursor-not-allowed rounded border border-slate-700 bg-slate-900/40 px-3 text-slate-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">lnbits_base_url</span>
          <input
            value={lnbitsBaseURL}
            onChange={(event) => setLNBitsBaseURL(event.target.value)}
            placeholder="http://lnbits:5000"
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">FAP_LNBITS_INVOICE_API_KEY</span>
          <input
            type="password"
            value={lnbitsInvoiceKey}
            onChange={(event) => setLNBitsInvoiceKey(event.target.value)}
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">FAP_LNBITS_READONLY_API_KEY</span>
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
        onClick={() => {
          void handleSave();
        }}
        disabled={isSaving}
        className="h-10 rounded bg-cyan-400 px-4 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSaving ? "Saving..." : "Save Payee"}
      </button>

      <div className="space-y-2 rounded border border-slate-700 p-3">
        <p className="text-xs font-medium text-slate-300">Artists ({artistsLoading ? "loading..." : artists.length})</p>
        <div className="max-h-48 space-y-1 overflow-y-auto text-xs">
          {artists.map((artist) => (
            <button
              key={artist.artist_id}
              type="button"
              onClick={() => {
                setArtistID(artist.artist_id);
                if (!displayName.trim()) {
                  setDisplayName(artist.display_name || artist.handle);
                }
              }}
              className="block w-full rounded border border-slate-700 px-2 py-1 text-left hover:border-cyan-300"
            >
              {artist.display_name || artist.handle} | {artist.handle} | {artist.artist_id}
            </button>
          ))}
          {artists.length === 0 && !artistsLoading ? (
            <p className="text-slate-500">No artists returned by catalog browse.</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2 rounded border border-slate-700 p-3">
        <p className="text-xs font-medium text-slate-300">Recent artist_ids (local)</p>
        <div className="flex flex-wrap gap-2">
          {recentArtistIDs.map((recentID) => (
            <button
              key={recentID}
              type="button"
              onClick={() => setArtistID(recentID)}
              className="rounded border border-slate-600 px-2 py-1 text-xs hover:border-cyan-300"
            >
              {recentID}
            </button>
          ))}
          {recentArtistIDs.length === 0 ? <p className="text-xs text-slate-500">none</p> : null}
        </div>
      </div>
    </section>
  );
}
