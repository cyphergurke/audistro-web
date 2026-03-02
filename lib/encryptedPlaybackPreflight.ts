export type EncryptedPreflightCheckStatus = "idle" | "running" | "pass" | "fail";

export type EncryptedPreflightStepID =
  | "playback"
  | "token"
  | "playlist"
  | "key"
  | "segment"
  | "fallback";

export type EncryptedPreflightStep = {
  id: EncryptedPreflightStepID;
  label: string;
  status: EncryptedPreflightCheckStatus;
  message?: string;
};

export type EncryptedPreflightProviderResult = {
  providerId: string;
  baseUrl: string;
  playlistUrl: string;
  playlistStatus: "pass" | "fail";
  playlistMessage?: string;
  keyUri: string | null;
  keyStatus: "pass" | "fail" | "skipped";
  keyLength: number | null;
  keyMessage?: string;
  segmentUrl: string | null;
  segmentStatus: "pass" | "fail" | "skipped";
  segmentMessage?: string;
};

export type EncryptedPreflightBundle = {
  assetId: string;
  startedAt: number;
  finishedAt: number;
  tokenExpiresAt: number | null;
  playbackProviders: Array<{
    providerId: string;
    baseUrl: string;
  }>;
  providers: EncryptedPreflightProviderResult[];
  fallbackReady: boolean;
};

export function createEncryptedPreflightSteps(): EncryptedPreflightStep[] {
  return [
    { id: "playback", label: "Playback metadata", status: "idle" },
    { id: "token", label: "Access token", status: "idle" },
    { id: "playlist", label: "Playlist fetch", status: "idle" },
    { id: "key", label: "Key proxy fetch", status: "idle" },
    { id: "segment", label: "First segment fetch", status: "idle" },
    { id: "fallback", label: "Fallback readiness", status: "idle" }
  ];
}

export function extractEncryptedKeyUri(playlistText: string): string | null {
  for (const line of playlistText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("#EXT-X-KEY:")) {
      continue;
    }
    const match = trimmed.match(/URI="([^"]+)"/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

export function extractFirstMediaReference(playlistText: string): string | null {
  for (const line of playlistText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    return trimmed;
  }
  return null;
}

export function absolutizePlaylistReference(reference: string, playlistUrl: string): string {
  return new URL(reference, playlistUrl).toString();
}
