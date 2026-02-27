export type BoostStatus = "pending" | "paid" | "expired" | "failed";

export type BoostCreateResponse = {
  boost_id: string;
  asset_id: string;
  payee_id: string;
  amount_msat: number;
  bolt11: string;
  expires_at: number;
  status: BoostStatus;
};

export type BoostStatusResponse = {
  boost_id: string;
  status: BoostStatus;
  paid_at: number | null;
  expires_at: number;
  amount_msat: number;
};

export type BoostListItem = {
  boost_id: string;
  asset_id: string;
  payee_id: string;
  amount_msat: number;
  status: BoostStatus;
  expires_at: number;
  created_at: number;
  paid_at: number | null;
  bolt11?: string;
};

export type BoostListResponse = {
  items: BoostListItem[];
  next_cursor?: string;
};

export type BoostReceipt = {
  boostId: string;
  assetId: string;
  amountSats: number;
  status: BoostStatus;
  createdAt: number;
  paidAt?: number;
};
