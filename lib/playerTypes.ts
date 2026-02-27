export type PlayerStatus =
  | "Idle"
  | "LoadingPlayback"
  | "FetchingToken"
  | "LoadingManifest"
  | "Playing"
  | "SwitchingProvider"
  | "RefreshingToken"
  | "Failed";

export type PlayerErrorBase = {
  type: string;
  details: string;
  fatal: boolean;
  responseCode?: number;
  url?: string;
  providerId: string;
  timestamp: number;
};

export type KeyPlayerError = PlayerErrorBase & {
  kind: "key";
};

export type FragmentPlayerError = PlayerErrorBase & {
  kind: "fragment";
};

export type ManifestPlayerError = PlayerErrorBase & {
  kind: "manifest";
};

export type MediaPlayerError = PlayerErrorBase & {
  kind: "media";
};

export type OtherPlayerError = PlayerErrorBase & {
  kind: "other";
};

export type PlayerError =
  | KeyPlayerError
  | FragmentPlayerError
  | ManifestPlayerError
  | MediaPlayerError
  | OtherPlayerError;

export type AttemptLogEntry = {
  providerId: string;
  baseUrl: string;
  startedAt: number;
  endedAt?: number;
  outcome: "selected" | "failed";
  failureReason?: string;
  errors: PlayerError[];
};

export type DebugSnapshot = {
  assetId: string;
  status: PlayerStatus;
  selectedProviderId: string | null;
  selectedProviderBaseUrl: string | null;
  playlistSourceUrl: string | null;
  tokenExpiresAt: number | null;
  lastError: PlayerError | null;
  errors: PlayerError[];
  attemptLogs: AttemptLogEntry[];
};

export type TokenResult = {
  token: string;
  expiresAt: number;
};

export interface TokenProvider {
  getToken(assetId: string): Promise<TokenResult>;
  refreshToken(assetId: string): Promise<TokenResult>;
}
