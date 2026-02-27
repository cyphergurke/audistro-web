export type LedgerItem = {
  kind: "access" | "boost";
  status: "pending" | "paid" | "expired" | "failed" | "refunded";
  asset_id?: string;
  payee_id: string;
  amount_msat: number;
  created_at: number;
  paid_at?: number | null;
};

export type SpendAggregationResult = {
  totals: {
    paid_msat_access: number;
    paid_msat_boost: number;
    paid_msat_total: number;
  };
  by_asset_id: Map<string, number>;
  by_payee_id: Map<string, number>;
  paid_items_count: number;
};

export function aggregateSpend(items: LedgerItem[]): SpendAggregationResult {
  let paidMSatAccess = 0;
  let paidMSatBoost = 0;
  let paidItemsCount = 0;
  const byAssetID = new Map<string, number>();
  const byPayeeID = new Map<string, number>();

  for (const item of items) {
    if (item.status !== "paid") {
      continue;
    }
    paidItemsCount += 1;
    if (item.kind === "access") {
      paidMSatAccess += item.amount_msat;
    } else {
      paidMSatBoost += item.amount_msat;
    }

    byPayeeID.set(item.payee_id, (byPayeeID.get(item.payee_id) ?? 0) + item.amount_msat);

    const assetID = item.asset_id?.trim() ?? "";
    if (assetID) {
      byAssetID.set(assetID, (byAssetID.get(assetID) ?? 0) + item.amount_msat);
    }
  }

  return {
    totals: {
      paid_msat_access: paidMSatAccess,
      paid_msat_boost: paidMSatBoost,
      paid_msat_total: paidMSatAccess + paidMSatBoost
    },
    by_asset_id: byAssetID,
    by_payee_id: byPayeeID,
    paid_items_count: paidItemsCount
  };
}

export function topN<K extends string>(entries: Map<K, number>, n: number): Array<{ key: K; amount_msat: number }> {
  const normalizedN = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
  if (normalizedN <= 0) {
    return [];
  }
  return [...entries.entries()]
    .map(([key, amountMSat]) => ({ key, amount_msat: amountMSat }))
    .sort((a, b) => {
      if (b.amount_msat !== a.amount_msat) {
        return b.amount_msat - a.amount_msat;
      }
      return a.key.localeCompare(b.key);
    })
    .slice(0, normalizedN);
}
