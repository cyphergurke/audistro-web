"use client";

import Hls, { type ErrorData } from "hls.js";
import { classifyHlsError, sanitizeUrl } from "@/lib/playerErrorClassifier";
import { decidePlaybackAction } from "@/lib/playerPolicies";
import type {
  AttemptLogEntry,
  DebugSnapshot,
  FragmentPlayerError,
  ManifestPlayerError,
  PlayerError,
  PlayerStatus,
  TokenProvider,
  TokenResult
} from "@/lib/playerTypes";
import type { PlaybackResponse } from "@/lib/types";

const playlistPreflightTimeoutMs = 5000;
const providerStartupTimeoutMs = 8000;
const maxTokenRefreshAttempts = 1;
const initialBufferTargetSeconds = 2.0;
const lastSuccessfulProviderByAssetId = new Map<string, string>();

type Provider = PlaybackResponse["providers"][number];

type ProviderAttemptOutcome =
  | { kind: "playing" }
  | { kind: "refresh"; reason: string }
  | { kind: "switch"; reason: string }
  | { kind: "fail"; reason: string };

type EngineCallbacks = {
  onStatusChange?: (status: PlayerStatus) => void;
  onDebugChange?: (snapshot: DebugSnapshot) => void;
  onFailure?: (message: string) => void;
};

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return "unexpected error";
}

function createPlaylistSourceUrl(assetId: string, providerId: string, token: string): string {
  const params = new URLSearchParams({
    providerId,
    token
  });
  return `/api/playlist/${encodeURIComponent(assetId)}?${params.toString()}`;
}

function createManifestFailureError(args: {
  providerId: string;
  playlistUrl: string;
  status?: number;
  details: string;
}): ManifestPlayerError {
  return {
    kind: "manifest",
    type: "networkError",
    details: args.details,
    fatal: true,
    responseCode: args.status,
    url: sanitizeUrl(args.playlistUrl),
    providerId: args.providerId,
    timestamp: Date.now()
  };
}

function createFragmentFailureError(args: {
  providerId: string;
  segmentUrl: string;
  status?: number;
  details: string;
}): FragmentPlayerError {
  return {
    kind: "fragment",
    type: "networkError",
    details: args.details,
    fatal: false,
    responseCode: args.status,
    url: sanitizeUrl(args.segmentUrl),
    providerId: args.providerId,
    timestamp: Date.now()
  };
}

function firstSegmentUrlFromPlaylist(playlistText: string): string | null {
  const lines = playlistText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    return trimmed;
  }
  return null;
}

export class PlayerEngine {
  private readonly video: HTMLVideoElement;
  private readonly playback: PlaybackResponse;
  private readonly tokenProvider: TokenProvider;
  private readonly callbacks: EngineCallbacks;

  private status: PlayerStatus = "Idle";
  private assetId = "";
  private hls: Hls | null = null;
  private playSessionId = 0;
  private refreshAttempts = 0;
  private providerSwitches = 0;
  private readonly maxProviderSwitches: number;
  private currentProviderIndex = -1;
  private consecutiveFragmentFailures = 0;
  private runtimeRecoveryInFlight = false;
  private attemptedProviderIndexes = new Set<number>();

  private token: TokenResult | null = null;
  private selectedProviderId: string | null = null;
  private selectedProviderBaseUrl: string | null = null;
  private playlistSourceUrl: string | null = null;

  private attemptLogs: AttemptLogEntry[] = [];
  private activeAttemptIndex: number | null = null;
  private errors: PlayerError[] = [];
  private lastError: PlayerError | null = null;

  constructor(args: {
    video: HTMLVideoElement;
    playback: PlaybackResponse;
    tokenProvider: TokenProvider;
    onStatusChange?: (status: PlayerStatus) => void;
    onDebugChange?: (snapshot: DebugSnapshot) => void;
    onFailure?: (message: string) => void;
  }) {
    this.video = args.video;
    this.playback = args.playback;
    this.tokenProvider = args.tokenProvider;
    this.callbacks = {
      onStatusChange: args.onStatusChange,
      onDebugChange: args.onDebugChange,
      onFailure: args.onFailure
    };
    this.maxProviderSwitches = Math.min(3, this.playback.providers.length);
    this.emitDebug();
  }

  public async play(assetId: string): Promise<void> {
    const normalizedAssetId = assetId.trim();
    if (normalizedAssetId === "") {
      throw new Error("assetId is required");
    }
    if (this.playback.providers.length === 0) {
      throw new Error("no playback providers available");
    }

    this.beginNewSession(normalizedAssetId);
    const session = this.playSessionId;

    this.setStatus("FetchingToken");
    try {
      this.token = await this.tokenProvider.getToken(normalizedAssetId);
    } catch (err: unknown) {
      const message = `failed to fetch token: ${toErrorMessage(err)}`;
      this.failPlayback(message);
      throw new Error(message);
    }

    if (session !== this.playSessionId) {
      return;
    }
    this.emitDebug();

    const preferredStartIndex = this.getPreferredProviderStartIndex(normalizedAssetId);
    const activated = await this.activateFromProviderIndex(
      preferredStartIndex,
      "LoadingManifest",
      session
    );
    if (!activated) {
      throw new Error("playback failed");
    }
  }

  public stop(): void {
    this.playSessionId += 1;
    this.runtimeRecoveryInFlight = false;
    this.destroyHls();
    this.resetVideoElement();
    this.status = "Idle";
    this.assetId = "";
    this.token = null;
    this.refreshAttempts = 0;
    this.providerSwitches = 0;
    this.currentProviderIndex = -1;
    this.consecutiveFragmentFailures = 0;
    this.attemptedProviderIndexes = new Set<number>();
    this.selectedProviderId = null;
    this.selectedProviderBaseUrl = null;
    this.playlistSourceUrl = null;
    this.attemptLogs = [];
    this.activeAttemptIndex = null;
    this.errors = [];
    this.lastError = null;
    this.emitStatus();
    this.emitDebug();
  }

  public getDebugSnapshot(): DebugSnapshot {
    return {
      assetId: this.assetId,
      status: this.status,
      selectedProviderId: this.selectedProviderId,
      selectedProviderBaseUrl: this.selectedProviderBaseUrl,
      playlistSourceUrl: this.playlistSourceUrl,
      tokenExpiresAt: this.token?.expiresAt ?? null,
      lastError: this.lastError,
      errors: [...this.errors],
      attemptLogs: this.attemptLogs.map((entry) => ({
        ...entry,
        errors: [...entry.errors]
      }))
    };
  }

  private beginNewSession(assetId: string): void {
    this.playSessionId += 1;
    this.runtimeRecoveryInFlight = false;
    this.destroyHls();
    this.resetVideoElement();

    this.assetId = assetId;
    this.refreshAttempts = 0;
    this.providerSwitches = 0;
    this.currentProviderIndex = -1;
    this.consecutiveFragmentFailures = 0;
    this.attemptedProviderIndexes = new Set<number>();
    this.selectedProviderId = null;
    this.selectedProviderBaseUrl = null;
    this.playlistSourceUrl = null;
    this.attemptLogs = [];
    this.activeAttemptIndex = null;
    this.errors = [];
    this.lastError = null;
    this.emitDebug();
  }

  private getPreferredProviderStartIndex(assetId: string): number {
    const preferredProviderId = lastSuccessfulProviderByAssetId.get(assetId);
    if (!preferredProviderId) {
      return 0;
    }

    const preferredIndex = this.playback.providers.findIndex(
      (provider) => provider.provider_id === preferredProviderId
    );
    return preferredIndex >= 0 ? preferredIndex : 0;
  }

  private rememberSuccessfulProvider(providerId: string): void {
    if (this.assetId.trim() === "") {
      return;
    }
    lastSuccessfulProviderByAssetId.set(this.assetId, providerId);
  }

  private async activateFromProviderIndex(
    startIndex: number,
    initialStatus: "LoadingManifest" | "SwitchingProvider",
    session: number
  ): Promise<boolean> {
    let providerIndex = startIndex;
    let status = initialStatus;

    while (session === this.playSessionId) {
      this.setStatus(status);
      const attempt = await this.trySingleProvider(providerIndex, session);
      if (session !== this.playSessionId) {
        return false;
      }

      if (attempt.kind === "playing") {
        return true;
      }

      if (attempt.kind === "refresh") {
        const refreshed = await this.refreshToken(session);
        if (!refreshed) {
          return false;
        }
        status = "LoadingManifest";
        continue;
      }

      if (attempt.kind === "switch") {
        const nextIndex = this.computeNextProviderIndex(providerIndex);
        if (nextIndex === null) {
          this.failPlayback(`${attempt.reason}; no more providers or switch limit reached`);
          return false;
        }
        providerIndex = nextIndex;
        status = "SwitchingProvider";
        continue;
      }

      this.failPlayback(attempt.reason);
      return false;
    }

    return false;
  }

  private async trySingleProvider(
    providerIndex: number,
    session: number
  ): Promise<ProviderAttemptOutcome> {
    const provider = this.playback.providers[providerIndex];
    const token = this.token;

    if (!provider || !token) {
      return {
        kind: "fail",
        reason: "provider/token is unavailable"
      };
    }

    this.currentProviderIndex = providerIndex;
    this.attemptedProviderIndexes.add(providerIndex);
    this.consecutiveFragmentFailures = 0;
    this.selectedProviderId = provider.provider_id;
    this.selectedProviderBaseUrl = provider.base_url;
    this.activeAttemptIndex = this.startAttempt(provider);

    const playlistSourceUrl = createPlaylistSourceUrl(
      this.assetId,
      provider.provider_id,
      token.token
    );
    this.playlistSourceUrl = playlistSourceUrl;
    this.emitDebug();

    const preflight = await this.preflightManifest(playlistSourceUrl);
    if (session !== this.playSessionId) {
      return { kind: "fail", reason: "stale session" };
    }
    if (!preflight.ok) {
      const manifestError = createManifestFailureError({
        providerId: provider.provider_id,
        playlistUrl: playlistSourceUrl,
        status: preflight.status,
        details: preflight.details
      });
      this.appendError(manifestError);
      this.markActiveAttemptFailed(`manifest fail: ${preflight.message}`);
      return {
        kind: "switch",
        reason: `manifest fail: ${preflight.message}`
      };
    }

    const firstSegmentUrl = firstSegmentUrlFromPlaylist(preflight.playlistText);
    if (!firstSegmentUrl) {
      const manifestError = createManifestFailureError({
        providerId: provider.provider_id,
        playlistUrl: playlistSourceUrl,
        details: "MANIFEST_LOAD_ERROR",
        status: 502
      });
      this.appendError(manifestError);
      this.markActiveAttemptFailed("manifest fail: no media segments");
      return {
        kind: "switch",
        reason: "manifest fail: no media segments"
      };
    }

    const segmentPreflight = await this.preflightFirstSegment(firstSegmentUrl);
    if (session !== this.playSessionId) {
      return { kind: "fail", reason: "stale session" };
    }
    if (!segmentPreflight.ok) {
      const fragmentError = createFragmentFailureError({
        providerId: provider.provider_id,
        segmentUrl: firstSegmentUrl,
        status: segmentPreflight.status,
        details: segmentPreflight.details
      });
      this.appendError(fragmentError);
      this.markActiveAttemptFailed(`segment preflight fail: ${segmentPreflight.message}`);
      return {
        kind: "switch",
        reason: `segment preflight fail: ${segmentPreflight.message}`
      };
    }

    if (!Hls.isSupported()) {
      this.markActiveAttemptFailed("hls.js is not supported in this browser");
      return {
        kind: "fail",
        reason: "hls.js is not supported in this browser"
      };
    }

    this.destroyHls();

    return new Promise<ProviderAttemptOutcome>((resolve) => {
      let settled = false;
      let playbackStarted = false;
      let playTriggered = false;
      let manifestParsed = false;

      const settle = (outcome: ProviderAttemptOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(startupTimeoutId);
        this.video.removeEventListener("playing", onVideoPlaying);
        this.video.removeEventListener("canplay", onVideoCanPlay);
        if (outcome.kind !== "playing") {
          this.destroyHls();
        }
        resolve(outcome);
      };

      const startupTimeoutId = window.setTimeout(() => {
        if (manifestParsed) {
          if (!playTriggered) {
            playTriggered = true;
            playbackStarted = true;
            this.setStatus("Playing");
            void this.video.play().catch(() => undefined);
          }
          settle({ kind: "playing" });
          return;
        }
        const timeoutError = createManifestFailureError({
          providerId: provider.provider_id,
          playlistUrl: playlistSourceUrl,
          status: 408,
          details: "MANIFEST_LOAD_TIMEOUT"
        });
        this.appendError(timeoutError);
        this.markActiveAttemptFailed("manifest fail: timeout");
        settle({
          kind: "switch",
          reason: "manifest fail: timeout"
        });
      }, providerStartupTimeoutMs);

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startFragPrefetch: true,
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        maxBufferHole: 1.0,
        maxFragLookUpTolerance: 0.25,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 6,
        xhrSetup: (xhr, url) => {
          if (url.includes("/hls/") && url.includes("/key") && token.token) {
            xhr.setRequestHeader("Authorization", `Bearer ${token.token}`);
          }
        }
      });
      this.hls = hls;

      const bufferedAheadSeconds = (): number => {
        const currentTime = this.video.currentTime;
        for (let i = 0; i < this.video.buffered.length; i += 1) {
          const start = this.video.buffered.start(i);
          const end = this.video.buffered.end(i);
          if (currentTime <= end) {
            if (currentTime < start) {
              return end - start;
            }
            return end - currentTime;
          }
        }
        return 0;
      };

      const maybeStartPlayback = (): void => {
        if (settled || playTriggered) {
          return;
        }
        if (bufferedAheadSeconds() < initialBufferTargetSeconds) {
          return;
        }
        playTriggered = true;
        playbackStarted = true;
        this.setStatus("Playing");
        void this.video.play().catch(() => undefined);
        settle({ kind: "playing" });
      };

      const onVideoPlaying = (): void => {
        if (settled || playbackStarted) {
          return;
        }
        playbackStarted = true;
        this.rememberSuccessfulProvider(provider.provider_id);
        this.setStatus("Playing");
        settle({ kind: "playing" });
      };

      const onVideoCanPlay = (): void => {
        maybeStartPlayback();
      };

      this.video.addEventListener("playing", onVideoPlaying);
      this.video.addEventListener("canplay", onVideoCanPlay);

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(playlistSourceUrl);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        manifestParsed = true;
        maybeStartPlayback();
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        this.consecutiveFragmentFailures = 0;
        maybeStartPlayback();
      });

      hls.on(Hls.Events.ERROR, (_event, data: ErrorData) => {
        const playerError = classifyHlsError({
          data,
          providerId: provider.provider_id
        });
        this.appendError(playerError);
        const decision = decidePlaybackAction({
          error: playerError,
          consecutiveFragmentFailures: this.consecutiveFragmentFailures
        });
        this.consecutiveFragmentFailures = decision.nextConsecutiveFragmentFailures;

        if (!playbackStarted) {
          if (decision.shouldRefreshToken) {
            const reason = `${decision.reason ?? "key unauthorized"}: ${playerError.details}`;
            this.markActiveAttemptFailed(reason);
            settle({
              kind: "refresh",
              reason
            });
            return;
          }
          if (decision.shouldSwitchProvider) {
            const reason = `${decision.reason ?? "provider fail"}: ${playerError.details}`;
            this.markActiveAttemptFailed(reason);
            settle({
              kind: "switch",
              reason
            });
            return;
          }
          if (playerError.fatal) {
            const reason = `fatal error: ${playerError.type}/${playerError.details}`;
            this.markActiveAttemptFailed(reason);
            settle({
              kind: "fail",
              reason
            });
          }
          return;
        }

        void this.handleRuntimeError(playerError, decision, session);
      });

      hls.attachMedia(this.video);
    });
  }

  private async handleRuntimeError(
    playerError: PlayerError,
    decision: ReturnType<typeof decidePlaybackAction>,
    session: number
  ): Promise<void> {
    if (session !== this.playSessionId || this.runtimeRecoveryInFlight) {
      return;
    }

    if (!decision.shouldRefreshToken && !decision.shouldSwitchProvider && !playerError.fatal) {
      return;
    }

    this.runtimeRecoveryInFlight = true;
    try {
      if (decision.shouldRefreshToken) {
        const reason = `${decision.reason ?? "key unauthorized"}: ${playerError.details}`;
        this.markActiveAttemptFailed(reason);
        const refreshed = await this.refreshToken(session);
        if (!refreshed || this.currentProviderIndex < 0) {
          return;
        }
        await this.activateFromProviderIndex(this.currentProviderIndex, "LoadingManifest", session);
        return;
      }

      if (decision.shouldSwitchProvider) {
        const reason = `${decision.reason ?? "provider fail"}: ${playerError.details}`;
        this.markActiveAttemptFailed(reason);
        const nextIndex = this.computeNextProviderIndex(this.currentProviderIndex);
        if (nextIndex === null) {
          this.failPlayback(`${reason}; no more providers or switch limit reached`);
          return;
        }
        await this.activateFromProviderIndex(nextIndex, "SwitchingProvider", session);
        return;
      }

      const reason = `fatal error: ${playerError.type}/${playerError.details}`;
      this.markActiveAttemptFailed(reason);
      this.failPlayback(reason);
    } finally {
      this.runtimeRecoveryInFlight = false;
    }
  }

  private async refreshToken(session: number): Promise<boolean> {
    if (this.refreshAttempts >= maxTokenRefreshAttempts) {
      this.failPlayback("token refresh limit reached");
      return false;
    }

    this.setStatus("RefreshingToken");
    try {
      this.token = await this.tokenProvider.refreshToken(this.assetId);
      this.refreshAttempts += 1;
      if (session !== this.playSessionId) {
        return false;
      }
      this.emitDebug();
      return true;
    } catch (err: unknown) {
      const message = `token refresh failed: ${toErrorMessage(err)}`;
      this.failPlayback(message);
      return false;
    }
  }

  private computeNextProviderIndex(currentIndex: number): number | null {
    const providersCount = this.playback.providers.length;
    if (providersCount === 0) {
      return null;
    }
    if (this.providerSwitches >= this.maxProviderSwitches) {
      return null;
    }

    for (let step = 1; step <= providersCount; step += 1) {
      const candidate = (currentIndex + step) % providersCount;
      if (!this.attemptedProviderIndexes.has(candidate)) {
        this.providerSwitches += 1;
        return candidate;
      }
    }

    return null;
  }

  private startAttempt(provider: Provider): number {
    const entry: AttemptLogEntry = {
      providerId: provider.provider_id,
      baseUrl: provider.base_url,
      startedAt: Date.now(),
      outcome: "selected",
      errors: []
    };
    this.attemptLogs.push(entry);
    this.emitDebug();
    return this.attemptLogs.length - 1;
  }

  private markActiveAttemptFailed(reason: string): void {
    if (this.activeAttemptIndex === null) {
      return;
    }
    const entry = this.attemptLogs[this.activeAttemptIndex];
    if (!entry) {
      return;
    }
    if (entry.outcome === "failed") {
      return;
    }
    entry.outcome = "failed";
    entry.failureReason = reason;
    entry.endedAt = Date.now();

    const rememberedProviderId = lastSuccessfulProviderByAssetId.get(this.assetId);
    if (rememberedProviderId && rememberedProviderId === entry.providerId) {
      lastSuccessfulProviderByAssetId.delete(this.assetId);
    }

    this.emitDebug();
  }

  private appendError(error: PlayerError): void {
    const isBenignMediaError =
      error.kind === "media" &&
      !error.fatal &&
      (error.details === "bufferStalledError" ||
        error.details === "bufferSeekOverHole" ||
        error.details === "bufferNudgeOnStall");

    if (!isBenignMediaError) {
      this.lastError = error;
    }

    this.errors.push(error);
    if (this.errors.length > 20) {
      this.errors.shift();
    }

    if (this.activeAttemptIndex !== null) {
      const entry = this.attemptLogs[this.activeAttemptIndex];
      if (entry) {
        entry.errors.push(error);
        if (entry.errors.length > 20) {
          entry.errors.shift();
        }
      }
    }
    this.emitDebug();
  }

  private async preflightManifest(
    playlistSourceUrl: string
  ): Promise<
    | { ok: true; playlistText: string }
    | { ok: false; status?: number; details: string; message: string }
  > {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), playlistPreflightTimeoutMs);
    try {
      const response = await fetch(playlistSourceUrl, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });
      const body = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          details: response.status === 408 ? "MANIFEST_LOAD_TIMEOUT" : "MANIFEST_LOAD_ERROR",
          message: body || `playlist preflight failed (${response.status})`
        };
      }
      return { ok: true, playlistText: body };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return {
          ok: false,
          status: 408,
          details: "MANIFEST_LOAD_TIMEOUT",
          message: "playlist preflight timeout"
        };
      }
      return {
        ok: false,
        status: 502,
        details: "MANIFEST_LOAD_ERROR",
        message: toErrorMessage(err)
      };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private async preflightFirstSegment(
    segmentUrl: string
  ): Promise<{ ok: true } | { ok: false; status?: number; details: string; message: string }> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), playlistPreflightTimeoutMs);
    try {
      const response = await fetch(segmentUrl, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.text();
        return {
          ok: false,
          status: response.status,
          details: response.status === 408 ? "FRAG_LOAD_TIMEOUT" : "FRAG_LOAD_ERROR",
          message: body || `segment preflight failed (${response.status})`
        };
      }
      return { ok: true };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return {
          ok: false,
          status: 408,
          details: "FRAG_LOAD_TIMEOUT",
          message: "segment preflight timeout"
        };
      }
      return {
        ok: false,
        status: 0,
        details: "FRAG_LOAD_ERROR",
        message: toErrorMessage(err)
      };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private destroyHls(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  private resetVideoElement(): void {
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
  }

  private failPlayback(message: string): void {
    this.destroyHls();
    this.setStatus("Failed");
    this.callbacks.onFailure?.(message);
  }

  private setStatus(status: PlayerStatus): void {
    this.status = status;
    this.emitStatus();
    this.emitDebug();
  }

  private emitStatus(): void {
    this.callbacks.onStatusChange?.(this.status);
  }

  private emitDebug(): void {
    this.callbacks.onDebugChange?.(this.getDebugSnapshot());
  }
}
