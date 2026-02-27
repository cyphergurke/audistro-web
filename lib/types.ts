export type ProviderHint = {
  base_url: string;
  provider_id: string;
  priority: number;
  expires_at: number;
  last_seen_at: number;
  region?: string | null;
  hint_score?: number | null;
  stale?: boolean | null;
  transport?: string;
};

export type PlaybackAsset = {
  asset_id: string;
  title?: string;
  duration_ms?: number;
  hls_master_url?: string;
  hls?: {
    key_uri_template?: string;
  };
  pay?: {
    resource_id?: string;
    challenge_url?: string;
    token_url?: string;
    fap_url?: string;
    payee_id?: string;
    fap_payee_id?: string;
    price_msat?: number;
  };
};

export type PlaybackResponse = {
  now: number;
  asset: PlaybackAsset;
  providers: ProviderHint[];
  api_version?: string;
  schema_version?: number;
};

export type FAPAccessResponse = {
  asset_id: string;
  access_token: string;
  expires_at: number;
};

export type AccessDevStartResponse = {
  mode: "dev";
  asset_id: string;
  access_token: string;
  expires_at: number;
};

export type AccessChallengeStartResponse = {
  mode: "invoice";
  challenge_id: string;
  bolt11: string;
  expires_at: number;
  amount_msat: number;
};

export type AccessStartResponse = AccessDevStartResponse | AccessChallengeStartResponse;

export type AccessTokenExchangeResponse =
  | {
      status: "pending";
    }
  | {
      status: "paid";
      access_token: string;
      expires_at: number;
      resource_id: string;
    }
  | {
      status: "expired" | "failed";
      error: string;
    };

export type AccessGrantStatus = "active" | "revoked" | "expired";

export type AccessGrant = {
  asset_id: string;
  status: AccessGrantStatus;
  valid_from: number | null;
  valid_until: number | null;
  minutes_purchased: number;
};

export type AccessGrantsResponse = {
  device_id?: string;
  items: AccessGrant[];
};

export type LedgerKind = "access" | "boost";

export type LedgerStatus = "pending" | "paid" | "expired" | "failed" | "refunded";

export type LedgerEntry = {
  entry_id: string;
  kind: LedgerKind;
  status: LedgerStatus;
  asset_id?: string;
  payee_id: string;
  amount_msat: number;
  currency: string;
  created_at: number;
  updated_at: number;
  paid_at: number | null;
  reference_id?: string;
};

export type LedgerListResponse = {
  device_id?: string;
  items: LedgerEntry[];
  next_cursor?: string;
};

export type SpendSummaryTotals = {
  paid_msat_access: number;
  paid_msat_boost: number;
  paid_msat_total: number;
};

export type TopAssetSpend = {
  asset_id: string;
  title?: string;
  artist?: string;
  amount_msat: number;
};

export type TopPayeeSpend = {
  payee_id: string;
  amount_msat: number;
};

export type SpendSummaryResponse = {
  window_days: 7 | 30;
  totals: SpendSummaryTotals;
  top_assets: TopAssetSpend[];
  top_payees: TopPayeeSpend[];
  items_count: number;
  truncated: boolean;
};
