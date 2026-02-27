"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { PlayerEngine } from "@/lib/playerEngine";
import { addRecent, clearRecent, isValidAssetId, loadRecent } from "@/lib/recentAssets";
import type { DebugSnapshot, PlayerStatus, TokenProvider } from "@/lib/playerTypes";
import type {
  AccessGrant,
  AccessGrantsResponse,
  AccessStartResponse,
  AccessTokenExchangeResponse,
  PlaybackResponse
} from "@/lib/types";

type PlayerProps = {
  initialAssetId?: string;
  showOpenButton?: boolean;
  showValidateButton?: boolean;
  showRecentList?: boolean;
  showAccessStatus?: boolean;
  bootstrapDeviceOnMount?: boolean;
  onStatusChange?: (status: PlayerStatus) => void;
};

type LookupState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "exists"; message: string }
  | { kind: "missing"; message: string }
  | { kind: "not_ready"; message: string }
  | { kind: "error"; message: string };

type AccessInvoiceStatus = "pending" | "paid" | "expired" | "failed";

type AccessInvoiceState = {
  challengeId: string;
  bolt11: string;
  expiresAt: number;
  amountMSat: number;
  status: AccessInvoiceStatus;
  message?: string;
};

type AccessGrantState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; grant: AccessGrant; updatedAt: number }
  | { kind: "error"; message: string };

const progressByStatus: Record<PlayerStatus, number> = {
  Idle: 0,
  LoadingPlayback: 10,
  FetchingToken: 30,
  LoadingManifest: 55,
  SwitchingProvider: 65,
  RefreshingToken: 75,
  Playing: 100,
  Failed: 100
};

function createInitialDebug(assetId: string): DebugSnapshot {
  return {
    assetId,
    status: "Idle",
    selectedProviderId: null,
    selectedProviderBaseUrl: null,
    playlistSourceUrl: null,
    tokenExpiresAt: null,
    lastError: null,
    errors: [],
    attemptLogs: []
  };
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return "Unexpected error";
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return JSON.parse(text) as T;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function parseLookupErrorBody(raw: string): string {
  if (!raw.trim()) {
    return "";
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.error === "string") {
        return record.error;
      }
      if (typeof record.message === "string") {
        return record.message;
      }
      if (typeof record.error === "object" && record.error !== null) {
        const errRecord = record.error as Record<string, unknown>;
        if (typeof errRecord.message === "string") {
          return errRecord.message;
        }
        if (typeof errRecord.code === "string") {
          return errRecord.code;
        }
      }
    }
  } catch {
    return raw;
  }
  return raw;
}

function formatUnixTimestamp(unixSeconds: number | null): string {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return "-";
  }
  return new Date(unixSeconds * 1000).toLocaleString();
}

function pickMostRelevantGrant(assetId: string, grants: AccessGrant[]): AccessGrant | null {
  const filtered = grants.filter((grant) => grant.asset_id === assetId);
  if (filtered.length === 0) {
    return null;
  }
  const active = filtered.find((grant) => grant.status === "active");
  if (active) {
    return active;
  }
  return filtered[0] ?? null;
}

export function Player({
  initialAssetId,
  showOpenButton = false,
  showValidateButton = false,
  showRecentList = false,
  showAccessStatus = false,
  bootstrapDeviceOnMount = false,
  onStatusChange
}: PlayerProps) {
  const router = useRouter();
  const defaultAssetId = process.env.NEXT_PUBLIC_DEFAULT_ASSET_ID ?? "asset2";
  const initialInputAssetId = (initialAssetId ?? defaultAssetId).trim();

  const [assetId, setAssetId] = useState<string>(initialInputAssetId);
  const [status, setStatus] = useState<PlayerStatus>("Idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [lookupState, setLookupState] = useState<LookupState>({ kind: "idle" });
  const [recentAssets, setRecentAssets] = useState<string[]>([]);
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot>(
    createInitialDebug(initialInputAssetId)
  );
  const [accessInvoice, setAccessInvoice] = useState<AccessInvoiceState | null>(null);
  const [accessInvoiceQR, setAccessInvoiceQR] = useState<string | null>(null);
  const [accessGrantState, setAccessGrantState] = useState<AccessGrantState>({ kind: "idle" });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<PlayerEngine | null>(null);
  const activePlaybackAssetIdRef = useRef<string>(initialInputAssetId);
  const playRequestInFlightRef = useRef<boolean>(false);
  const challengeByAssetRef = useRef<Map<string, string>>(new Map<string, string>());
  const bootstrapPromiseRef = useRef<Promise<void> | null>(null);

  const progress = useMemo(() => progressByStatus[status], [status]);
  const isBusy =
    status === "LoadingPlayback" ||
    status === "FetchingToken" ||
    status === "LoadingManifest" ||
    status === "SwitchingProvider" ||
    status === "RefreshingToken";

  useEffect(() => {
    const next = (initialAssetId ?? defaultAssetId).trim();
    setAssetId(next);
    setDebugSnapshot(createInitialDebug(next));
    setLookupState({ kind: "idle" });
  }, [defaultAssetId, initialAssetId]);

  useEffect(() => {
    if (!showRecentList) {
      return;
    }
    setRecentAssets(loadRecent());
  }, [showRecentList]);

  useEffect(() => {
    if (!accessInvoice) {
      setAccessInvoiceQR(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(accessInvoice.bolt11, { margin: 1, width: 180 })
      .then((dataURL: string) => {
        if (!cancelled) {
          setAccessInvoiceQR(dataURL);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccessInvoiceQR(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessInvoice]);

  useEffect(() => {
    return () => {
      engineRef.current?.stop();
      engineRef.current = null;
    };
  }, []);

  const ensureDeviceBootstrap = async (): Promise<void> => {
    if (!bootstrapDeviceOnMount) {
      return;
    }
    if (!bootstrapPromiseRef.current) {
      bootstrapPromiseRef.current = (async () => {
        const response = await fetch("/api/device/bootstrap", {
          method: "POST",
          cache: "no-store"
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(parseLookupErrorBody(text) || `device bootstrap failed (${response.status})`);
        }
      })().finally(() => {
        bootstrapPromiseRef.current = null;
      });
    }
    return bootstrapPromiseRef.current;
  };

  const refreshAccessGrant = async (
    targetAssetId: string,
    options?: { silent?: boolean }
  ): Promise<void> => {
    if (!showAccessStatus) {
      return;
    }
    const normalizedAssetId = targetAssetId.trim();
    if (!isValidAssetId(normalizedAssetId)) {
      setAccessGrantState({ kind: "idle" });
      return;
    }
    if (!options?.silent) {
      setAccessGrantState({ kind: "loading" });
    }
    try {
      const response = await fetch(
        `/api/access/grants?assetId=${encodeURIComponent(normalizedAssetId)}`,
        {
          method: "GET",
          cache: "no-store"
        }
      );
      const text = await response.text();
      if (!response.ok) {
        throw new Error(parseLookupErrorBody(text) || `grant lookup failed (${response.status})`);
      }
      const parsed = JSON.parse(text) as AccessGrantsResponse;
      const relevantGrant = pickMostRelevantGrant(normalizedAssetId, Array.isArray(parsed.items) ? parsed.items : []);
      if (!relevantGrant) {
        setAccessGrantState({ kind: "none" });
        return;
      }
      setAccessGrantState({
        kind: "ready",
        grant: relevantGrant,
        updatedAt: Date.now()
      });
    } catch (err: unknown) {
      setAccessGrantState({
        kind: "error",
        message: toErrorMessage(err)
      });
    }
  };

  useEffect(() => {
    if (!bootstrapDeviceOnMount) {
      return;
    }
    void ensureDeviceBootstrap().catch(() => {
      // The challenge route also auto-bootstraps; playback can still proceed.
    });
  }, [bootstrapDeviceOnMount]);

  useEffect(() => {
    if (!showAccessStatus) {
      return;
    }
    const normalizedAssetId = assetId.trim();
    if (!isValidAssetId(normalizedAssetId)) {
      setAccessGrantState({ kind: "idle" });
      return;
    }
    void (async () => {
      await ensureDeviceBootstrap().catch(() => {
        // Access status may still fail; show API error from grants call.
      });
      await refreshAccessGrant(normalizedAssetId);
    })();
  }, [assetId, showAccessStatus, bootstrapDeviceOnMount]);

  const updateStatus = (nextStatus: PlayerStatus): void => {
    setStatus(nextStatus);
    onStatusChange?.(nextStatus);

    if (nextStatus === "Playing") {
      const playedAssetId = activePlaybackAssetIdRef.current.trim();
      const updatedRecent = addRecent(playedAssetId);
      if (showRecentList) {
        setRecentAssets(updatedRecent);
      }
      if (showAccessStatus) {
        void refreshAccessGrant(playedAssetId, { silent: true });
      }
    }
  };

  const handleReset = (): void => {
    playRequestInFlightRef.current = false;
    engineRef.current?.stop();
    engineRef.current = null;
    setError(null);
    setAccessInvoice(null);
    setAccessInvoiceQR(null);
    if (showAccessStatus) {
      void refreshAccessGrant(assetId.trim(), { silent: true });
    }
    updateStatus("Idle");
    setLookupState({ kind: "idle" });
    setDebugSnapshot(createInitialDebug(assetId.trim()));
  };

  const handleValidate = async (): Promise<void> => {
    const normalizedAssetId = assetId.trim();
    if (!isValidAssetId(normalizedAssetId)) {
      setLookupState({
        kind: "error",
        message: "assetId must match ^[a-zA-Z0-9_-]{1,128}$"
      });
      return;
    }

    setLookupState({ kind: "checking" });
    try {
      const response = await fetch(`/api/playback/${encodeURIComponent(normalizedAssetId)}`, {
        method: "GET",
        cache: "no-store"
      });

      if (response.status === 200) {
        setLookupState({ kind: "exists", message: "catalog playback is available" });
        return;
      }

      const bodyText = await response.text();
      const parsedError = parseLookupErrorBody(bodyText);

      if (response.status === 501) {
        setLookupState({
          kind: "not_ready",
          message: parsedError || "not ready for playback"
        });
        return;
      }

      if (response.status === 404) {
        setLookupState({
          kind: "missing",
          message: parsedError || "asset not found"
        });
        return;
      }

      setLookupState({
        kind: "error",
        message: parsedError || `lookup failed (${response.status})`
      });
    } catch (err: unknown) {
      setLookupState({
        kind: "error",
        message: toErrorMessage(err)
      });
    }
  };

  const handleOpen = (): void => {
    const normalizedAssetId = assetId.trim();
    if (!isValidAssetId(normalizedAssetId)) {
      setError("Asset ID is invalid");
      updateStatus("Failed");
      return;
    }
    router.push(`/asset/${encodeURIComponent(normalizedAssetId)}`);
  };

  const createAdaptiveTokenProvider = (): TokenProvider => {
    const pollTokenExchange = async (
      normalizedAssetId: string,
      challengeId: string
    ): Promise<{ token: string; expiresAt: number }> => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 120_000) {
        const response = await fetch("/api/access/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            assetId: normalizedAssetId,
            challengeId
          })
        });
        const text = await response.text();
        if (!response.ok) {
          throw new Error(parseLookupErrorBody(text) || `token exchange failed (${response.status})`);
        }

        const parsed = JSON.parse(text) as AccessTokenExchangeResponse;
        if (parsed.status === "paid") {
          setAccessInvoice((previous) => {
            if (!previous || previous.challengeId !== challengeId) {
              return previous;
            }
            return {
              ...previous,
              status: "paid",
              message: "payment confirmed"
            };
          });
          if (showAccessStatus) {
            void refreshAccessGrant(normalizedAssetId, { silent: true });
          }
          return {
            token: parsed.access_token,
            expiresAt: parsed.expires_at
          };
        }

        if (parsed.status === "pending") {
          setAccessInvoice((previous) => {
            if (!previous || previous.challengeId !== challengeId) {
              return previous;
            }
            return {
              ...previous,
              status: "pending",
              message: "waiting for payment settlement"
            };
          });
          await sleep(2000);
          continue;
        }

        const terminalStatus: AccessInvoiceStatus = parsed.status;
        setAccessInvoice((previous) => {
          if (!previous || previous.challengeId !== challengeId) {
            return previous;
          }
          return {
            ...previous,
            status: terminalStatus,
            message: parsed.error
          };
        });
        throw new Error(parsed.error);
      }

      setAccessInvoice((previous) => {
        if (!previous || previous.challengeId !== challengeId) {
          return previous;
        }
        return {
          ...previous,
          status: "failed",
          message: "payment polling timed out"
        };
      });
      throw new Error("payment polling timed out");
    };

    const fetchAccess = async (inputAssetId: string): Promise<{ token: string; expiresAt: number }> => {
      const normalizedAssetId = inputAssetId.trim();
      const rememberedChallengeId = challengeByAssetRef.current.get(normalizedAssetId);

      if (rememberedChallengeId) {
        try {
          return await pollTokenExchange(normalizedAssetId, rememberedChallengeId);
        } catch {
          challengeByAssetRef.current.delete(normalizedAssetId);
        }
      }

      const encodedAssetId = encodeURIComponent(normalizedAssetId);
      const response = await fetch(`/api/access/${encodedAssetId}`, {
        method: "POST"
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(parseLookupErrorBody(text) || `access fetch failed (${response.status})`);
      }

      const parsed = JSON.parse(text) as AccessStartResponse;
      if (parsed.mode === "dev") {
        setAccessInvoice(null);
        setAccessInvoiceQR(null);
        return {
          token: parsed.access_token,
          expiresAt: parsed.expires_at
        };
      }

      challengeByAssetRef.current.set(normalizedAssetId, parsed.challenge_id);
      setAccessInvoice({
        challengeId: parsed.challenge_id,
        bolt11: parsed.bolt11,
        expiresAt: parsed.expires_at,
        amountMSat: parsed.amount_msat,
        status: "pending",
        message: "waiting for payment settlement"
      });
      return pollTokenExchange(normalizedAssetId, parsed.challenge_id);
    };

    return {
      getToken: fetchAccess,
      refreshToken: fetchAccess
    };
  };

  const handlePlay = async (): Promise<void> => {
    if (playRequestInFlightRef.current) {
      return;
    }
    playRequestInFlightRef.current = true;

    const normalizedAssetId = assetId.trim();
    if (!isValidAssetId(normalizedAssetId)) {
      setError("Asset ID must match ^[a-zA-Z0-9_-]{1,128}$");
      updateStatus("Failed");
      playRequestInFlightRef.current = false;
      return;
    }

    const video = videoRef.current;
    if (!video) {
      setError("Video element is not mounted");
      updateStatus("Failed");
      playRequestInFlightRef.current = false;
      return;
    }

    if (bootstrapDeviceOnMount) {
      try {
        await ensureDeviceBootstrap();
      } catch (err: unknown) {
        setError(`failed to bootstrap device: ${toErrorMessage(err)}`);
        updateStatus("Failed");
        playRequestInFlightRef.current = false;
        return;
      }
    }

    activePlaybackAssetIdRef.current = normalizedAssetId;
    setError(null);
    setAccessInvoice(null);
    setAccessInvoiceQR(null);
    updateStatus("LoadingPlayback");
    setDebugSnapshot({
      ...createInitialDebug(normalizedAssetId),
      status: "LoadingPlayback"
    });

    engineRef.current?.stop();
    engineRef.current = null;

    try {
      const encodedAssetId = encodeURIComponent(normalizedAssetId);
      const playback = await fetchJSON<PlaybackResponse>(`/api/playback/${encodedAssetId}`);
      if (playback.providers.length === 0) {
        throw new Error("No playback providers available");
      }

      const engine = new PlayerEngine({
        video,
        playback,
        tokenProvider: createAdaptiveTokenProvider(),
        onStatusChange: (nextStatus) => {
          updateStatus(nextStatus);
        },
        onDebugChange: (snapshot) => {
          setDebugSnapshot(snapshot);
        },
        onFailure: (message) => {
          setError(message);
        }
      });

      engineRef.current = engine;
      await engine.play(normalizedAssetId);
      setDebugSnapshot(engine.getDebugSnapshot());
    } catch (err: unknown) {
      setError(toErrorMessage(err));
      updateStatus("Failed");
      const snapshot = engineRef.current?.getDebugSnapshot();
      if (snapshot) {
        setDebugSnapshot(snapshot);
      }
    } finally {
      playRequestInFlightRef.current = false;
    }
  };

  const copyDebugJson = async (): Promise<void> => {
    const payload = JSON.stringify(debugSnapshot, null, 2);
    await navigator.clipboard.writeText(payload);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const handleClearRecent = (): void => {
    clearRecent();
    setRecentAssets([]);
  };

  const accessSummary =
    accessGrantState.kind === "loading"
      ? "checking access..."
      : accessGrantState.kind === "none"
        ? "no active access"
        : accessGrantState.kind === "ready"
          ? accessGrantState.grant.status === "active"
            ? accessGrantState.grant.valid_until
              ? `active until ${formatUnixTimestamp(accessGrantState.grant.valid_until)}`
              : "active (starts on first key fetch)"
            : `${accessGrantState.grant.status}`
          : accessGrantState.kind === "error"
            ? `error (${accessGrantState.message})`
            : "-";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <input
          aria-label="Asset ID"
          placeholder="asset2"
          value={assetId}
          className="h-11 flex-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 text-sm text-slate-100 outline-none ring-0 transition focus:border-cyan-400"
          onChange={(event) => {
            setAssetId(event.target.value);
            setLookupState({ kind: "idle" });
          }}
        />
        <button
          type="button"
          className="h-11 rounded-lg bg-cyan-400 px-5 text-sm font-medium text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handlePlay}
          disabled={isBusy}
        >
          {isBusy ? "Working..." : "Play"}
        </button>
        {showOpenButton ? (
          <button
            type="button"
            className="h-11 rounded-lg border border-cyan-400/60 px-5 text-sm font-medium text-cyan-200 transition hover:border-cyan-300"
            onClick={handleOpen}
          >
            Open
          </button>
        ) : null}
        {showValidateButton ? (
          <button
            type="button"
            className="h-11 rounded-lg border border-slate-600 px-5 text-sm font-medium text-slate-100 transition hover:border-cyan-300"
            onClick={handleValidate}
            disabled={lookupState.kind === "checking"}
          >
            {lookupState.kind === "checking" ? "Validating..." : "Validate"}
          </button>
        ) : null}
        <button
          type="button"
          className="h-11 rounded-lg border border-slate-600 px-5 text-sm font-medium text-slate-100 transition hover:border-cyan-300"
          onClick={handleReset}
        >
          Reset
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-slate-300">Status: {status}</p>
        <div className="h-2 overflow-hidden rounded bg-slate-800">
          <div
            className="h-full bg-cyan-400 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {showAccessStatus ? (
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-200">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">Access</p>
            <button
              type="button"
              className="rounded-md border border-slate-600 px-2 py-1 text-xs transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => {
                void refreshAccessGrant(assetId.trim());
              }}
              disabled={accessGrantState.kind === "loading"}
            >
              {accessGrantState.kind === "loading" ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <p className="mt-2">Access: {accessSummary}</p>
          {accessGrantState.kind === "ready" ? (
            <div className="mt-2 text-xs text-slate-400">
              <p>minutes purchased: {accessGrantState.grant.minutes_purchased}</p>
              <p>valid_from: {formatUnixTimestamp(accessGrantState.grant.valid_from)}</p>
              <p>valid_until: {formatUnixTimestamp(accessGrantState.grant.valid_until)}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {accessInvoice ? (
        <section className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/70 p-3 text-sm text-slate-200">
          <div className="flex items-center justify-between">
            <p className="font-medium">Access payment required</p>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs uppercase">
              {accessInvoice.status}
            </span>
          </div>
          <p>challenge: {accessInvoice.challengeId}</p>
          <p>amount: {Math.trunc(accessInvoice.amountMSat / 1000)} sats</p>
          <p>expires_at: {accessInvoice.expiresAt}</p>
          <div className="space-y-1">
            <p className="font-medium">bolt11</p>
            <p className="break-all rounded bg-slate-950/60 p-2 text-xs">{accessInvoice.bolt11}</p>
          </div>
          {accessInvoiceQR ? (
            <img src={accessInvoiceQR} alt="Access invoice QR code" width={180} height={180} />
          ) : (
            <p className="text-slate-400">QR unavailable</p>
          )}
          <p className="text-xs text-slate-400">
            {accessInvoice.message ?? "waiting for payment settlement"}
          </p>
        </section>
      ) : null}

      {showValidateButton ? (
        <p className="text-sm text-slate-300">
          Lookup: {lookupState.kind === "idle" ? "-" : null}
          {lookupState.kind === "checking" ? "checking..." : null}
          {lookupState.kind === "exists" ? `exists: yes (${lookupState.message})` : null}
          {lookupState.kind === "missing" ? `exists: no (${lookupState.message})` : null}
          {lookupState.kind === "not_ready"
            ? `not ready for playback (${lookupState.message})`
            : null}
          {lookupState.kind === "error" ? `error (${lookupState.message})` : null}
        </p>
      ) : null}

      {showRecentList ? (
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-200">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-medium">Recent</p>
            <button
              type="button"
              className="rounded-md border border-slate-600 px-2 py-1 text-xs transition hover:border-cyan-300"
              onClick={handleClearRecent}
              disabled={recentAssets.length === 0}
            >
              Clear
            </button>
          </div>
          {recentAssets.length === 0 ? (
            <p className="text-slate-400">No recent assets yet.</p>
          ) : (
            <ul className="space-y-1">
              {recentAssets.map((recentAssetId) => (
                <li key={recentAssetId}>
                  <Link
                    href={`/asset/${encodeURIComponent(recentAssetId)}`}
                    className="text-cyan-300 underline-offset-2 hover:underline"
                  >
                    /asset/{recentAssetId}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <video
        ref={videoRef}
        controls
        preload="metadata"
        className="w-full rounded-xl border border-slate-800 bg-black shadow-2xl"
      />

      {debugSnapshot.selectedProviderBaseUrl ? (
        <p className="text-sm text-slate-300">Provider: {debugSnapshot.selectedProviderBaseUrl}</p>
      ) : null}
      {debugSnapshot.lastError ? (
        <p className="text-sm text-amber-300">
          Last error: {debugSnapshot.lastError.kind} {debugSnapshot.lastError.type}/
          {debugSnapshot.lastError.details} fatal={String(debugSnapshot.lastError.fatal)} code=
          {debugSnapshot.lastError.responseCode ?? "-"}
        </p>
      ) : null}
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      <details className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-200">
        <summary className="cursor-pointer select-none font-medium">Debug</summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-1">
            <p>assetId: {debugSnapshot.assetId || "-"}</p>
            <p>selected provider id: {debugSnapshot.selectedProviderId ?? "-"}</p>
            <p>selected provider base: {debugSnapshot.selectedProviderBaseUrl ?? "-"}</p>
            <p>playlist source URL: {debugSnapshot.playlistSourceUrl ?? "-"}</p>
            <p>token expires_at: {debugSnapshot.tokenExpiresAt ?? "-"}</p>
            <p>errors recorded: {debugSnapshot.errors.length}</p>
          </div>

          <div>
            <p className="mb-1 font-medium">Provider attempts</p>
            {debugSnapshot.attemptLogs.length === 0 ? (
              <p className="text-slate-400">none</p>
            ) : (
              <ul className="space-y-1">
                {debugSnapshot.attemptLogs.map((attempt, index) => (
                  <li
                    key={`${attempt.providerId}-${attempt.startedAt}-${index}`}
                    className="rounded border border-slate-700 p-2"
                  >
                    <p>
                      {attempt.outcome.toUpperCase()} | {attempt.providerId} | {attempt.baseUrl}
                    </p>
                    <p className="text-slate-400">started: {attempt.startedAt}</p>
                    <p className="text-slate-400">ended: {attempt.endedAt ?? "-"}</p>
                    <p className="text-slate-400">reason: {attempt.failureReason ?? "selected"}</p>
                    <p className="text-slate-400">errors: {attempt.errors.length}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1 font-medium">Error list (last 20)</p>
            {debugSnapshot.errors.length === 0 ? (
              <p className="text-slate-400">none</p>
            ) : (
              <ul className="space-y-1">
                {debugSnapshot.errors.map((item, index) => (
                  <li
                    key={`${item.providerId}-${item.timestamp}-${index}`}
                    className="rounded border border-slate-700 p-2"
                  >
                    <p>
                      {item.kind} | {item.type}/{item.details}
                    </p>
                    <p className="text-slate-400">
                      provider={item.providerId} fatal={String(item.fatal)} code=
                      {item.responseCode ?? "-"}
                    </p>
                    <p className="text-slate-400">url={item.url ?? "-"}</p>
                    <p className="text-slate-400">ts={item.timestamp}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            className="rounded-md border border-slate-600 px-3 py-1 text-xs transition hover:border-cyan-300"
            onClick={copyDebugJson}
          >
            {copied ? "Copied" : "Copy debug JSON"}
          </button>
        </div>
      </details>
    </div>
  );
}
