"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type {
  CatalogArtist,
  CatalogBrowseArtistsResponse,
  CatalogIngestJobResponse,
  CatalogIngestUploadResponse,
  CatalogArtistPayeesResponse,
  CatalogPayee
} from "@/lib/adminTypes";

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
    if (typeof parsed.message === "string") {
      return parsed.message;
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

export function AdminUploadForm() {
  const searchParams = useSearchParams();
  const [artists, setArtists] = useState<CatalogArtist[]>([]);
  const [artistsLoading, setArtistsLoading] = useState(true);
  const [artistID, setArtistID] = useState("");
  const [payees, setPayees] = useState<CatalogPayee[]>([]);
  const [payeesLoading, setPayeesLoading] = useState(false);
  const [payeeID, setPayeeID] = useState("");
  const [title, setTitle] = useState("");
  const [priceMSat, setPriceMSat] = useState("1000");
  const [assetID, setAssetID] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<CatalogIngestUploadResponse | null>(null);
  const [job, setJob] = useState<CatalogIngestJobResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const initialArtistID = searchParams.get("artist_id");
    const initialPayeeID = searchParams.get("payee_id");
    if (initialArtistID) {
      setArtistID(initialArtistID);
    }
    if (initialPayeeID) {
      setPayeeID(initialPayeeID);
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        const response = await fetch("/api/admin/artists", { method: "GET", cache: "no-store" });
        const payload = await response.text();
        if (!response.ok) {
          throw new Error(parseErrorBody(payload) || `artist lookup failed (${response.status})`);
        }
        const parsed = JSON.parse(payload) as CatalogBrowseArtistsResponse;
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

  useEffect(() => {
    if (!submitResult?.job_id) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/admin/ingest/jobs/${submitResult.job_id}`, {
          method: "GET",
          cache: "no-store"
        });
        const payload = await response.text();
        if (!response.ok) {
          throw new Error(parseErrorBody(payload) || `job poll failed (${response.status})`);
        }
        const parsed = JSON.parse(payload) as CatalogIngestJobResponse;
        if (!cancelled) {
          setJob(parsed);
          if (parsed.status === "queued" || parsed.status === "processing") {
            timer = setTimeout(() => {
              void poll();
            }, 1500);
          }
        }
      } catch (err: unknown) {
        if (!cancelled && err instanceof Error) {
          setErrorMessage(err.message);
        }
      }
    };

    setJob(null);
    void poll();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [submitResult?.job_id]);

  const selectedArtist = useMemo(
    () => artists.find((artist) => artist.artist_id === artistID) ?? null,
    [artists, artistID]
  );

  useEffect(() => {
    if (!selectedArtist?.handle) {
      setPayees([]);
      return;
    }

    let cancelled = false;
    const run = async (): Promise<void> => {
      setPayeesLoading(true);
      try {
        const response = await fetch(`/api/admin/artists/${encodeURIComponent(selectedArtist.handle)}/payees`, {
          method: "GET",
          cache: "no-store"
        });
        const payload = await response.text();
        if (!response.ok) {
          throw new Error(parseErrorBody(payload) || `payee lookup failed (${response.status})`);
        }
        const parsed = JSON.parse(payload) as CatalogArtistPayeesResponse;
        const nextPayees = Array.isArray(parsed.payees) ? parsed.payees : [];
        if (!cancelled) {
          setPayees(nextPayees);
          setPayeeID((current) => {
            if (current && nextPayees.some((payee) => payee.payee_id === current)) {
              return current;
            }
            if (nextPayees.length === 1) {
              return nextPayees[0]?.payee_id ?? "";
            }
            return nextPayees[0]?.payee_id ?? "";
          });
        }
      } catch (err: unknown) {
        if (!cancelled && err instanceof Error) {
          setPayees([]);
          setErrorMessage(err.message);
        }
      } finally {
        if (!cancelled) {
          setPayeesLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedArtist?.handle]);

  const handleSubmit = async (): Promise<void> => {
    if (!file) {
      setErrorMessage("audio file is required");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    setSubmitResult(null);
    setJob(null);
    try {
      const form = new FormData();
      form.set("artist_id", artistID.trim());
      form.set("payee_id", payeeID.trim());
      form.set("title", title.trim());
      form.set("price_msat", priceMSat.trim());
      if (assetID.trim()) {
        form.set("asset_id", assetID.trim());
      }
      form.set("audio", file);

      const response = await fetch("/api/admin/assets/upload", {
        method: "POST",
        body: form
      });
      const payload = await response.text();
      if (!response.ok) {
        throw new Error(parseErrorBody(payload) || `upload failed (${response.status})`);
      }
      const parsed = JSON.parse(payload) as CatalogIngestUploadResponse;
      setSubmitResult(parsed);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("upload failed");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-200">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-100">MP3 Upload to HLS</h2>
        <p className="text-xs text-slate-400">
          Dev-only pipeline: store MP3 in catalog, package HLS with ffmpeg, publish to provider,
          rescan/announce, then expose the playable asset.
        </p>
        <p className="text-xs text-cyan-300">
          Need a fresh artist/payee first?{" "}
          <Link className="underline" href="/admin/bootstrap">
            Open /admin/bootstrap
          </Link>
        </p>
      </div>

      {errorMessage ? (
        <p className="rounded bg-rose-500/10 p-2 text-rose-300">{errorMessage}</p>
      ) : null}
      {submitResult ? (
        <p className="rounded bg-cyan-500/10 p-2 text-cyan-200">
          Queued asset <span className="font-mono">{submitResult.asset_id}</span> with job{" "}
          <span className="font-mono">{submitResult.job_id}</span>.
        </p>
      ) : null}
      {job?.status === "published" ? (
        <p className="rounded bg-emerald-500/10 p-2 text-emerald-300">
          Published. Open{" "}
          <Link className="underline" href={`/asset/${job.asset_id}`}>
            /asset/{job.asset_id}
          </Link>
        </p>
      ) : null}
      {job?.status === "failed" ? (
        <p className="rounded bg-rose-500/10 p-2 text-rose-300">
          Job failed: {job.error || "unknown error"}
        </p>
      ) : null}
      {job && job.status !== "published" && job.status !== "failed" ? (
        <p className="rounded bg-amber-500/10 p-2 text-amber-200">
          Job status: <span className="font-mono">{job.status}</span>
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-slate-400">artist_id</span>
          <select
            value={artistID}
            onChange={(event) => setArtistID(event.target.value)}
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          >
            <option value="">{artistsLoading ? "Loading artists..." : "Select artist"}</option>
            {artists.map((artist) => (
              <option key={artist.artist_id} value={artist.artist_id}>
                {artist.display_name || artist.handle} | {artist.artist_id}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">payee_id</span>
          {selectedArtist ? (
            <select
              value={payeeID}
              onChange={(event) => setPayeeID(event.target.value)}
              className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
            >
              <option value="">
                {payeesLoading ? "Loading payees..." : payees.length > 0 ? "Select payee" : "No payee for artist"}
              </option>
              {payees.map((payee) => (
                <option key={payee.payee_id} value={payee.payee_id}>
                  {payee.payee_id}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={payeeID}
              onChange={(event) => setPayeeID(event.target.value)}
              placeholder="Select artist first"
              className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
            />
          )}
        </label>

        <label className="space-y-1 md:col-span-2">
          <span className="text-xs text-slate-400">title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              selectedArtist
                ? `${selectedArtist.display_name || selectedArtist.handle} track`
                : "Track title"
            }
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">price_msat</span>
          <input
            value={priceMSat}
            onChange={(event) => setPriceMSat(event.target.value)}
            inputMode="numeric"
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">asset_id (optional)</span>
          <input
            value={assetID}
            onChange={(event) => setAssetID(event.target.value)}
            placeholder="auto: au_<sha256 prefix>"
            className="h-10 w-full rounded border border-slate-700 bg-slate-950/60 px-3 outline-none focus:border-cyan-400"
          />
        </label>

        <label className="space-y-1 md:col-span-2">
          <span className="text-xs text-slate-400">audio (mp3)</span>
          <input
            type="file"
            accept="audio/mpeg,.mp3"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block w-full rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-200 file:mr-4 file:rounded file:border-0 file:bg-cyan-400 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-950"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={isSubmitting}
        className="h-10 rounded bg-cyan-400 px-4 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? "Uploading..." : "Upload MP3"}
      </button>
    </section>
  );
}
