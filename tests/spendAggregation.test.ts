import { describe, expect, it } from "vitest";
import { aggregateSpend, topN, type LedgerItem } from "../lib/spendAggregation";

function item(overrides: Partial<LedgerItem>): LedgerItem {
  return {
    kind: "access",
    status: "paid",
    payee_id: "payee_1",
    amount_msat: 1000,
    created_at: 1700000000,
    ...overrides
  };
}

describe("spendAggregation", () => {
  it("splits totals for access vs boost", () => {
    const result = aggregateSpend([
      item({ kind: "access", amount_msat: 2000, payee_id: "payee_a", asset_id: "asset_1" }),
      item({ kind: "boost", amount_msat: 3000, payee_id: "payee_a", asset_id: "asset_1" }),
      item({ kind: "boost", amount_msat: 1500, payee_id: "payee_b" }),
      item({
        kind: "access",
        status: "pending",
        amount_msat: 9999,
        payee_id: "payee_c",
        asset_id: "asset_2"
      })
    ]);

    expect(result.totals.paid_msat_access).toBe(2000);
    expect(result.totals.paid_msat_boost).toBe(4500);
    expect(result.totals.paid_msat_total).toBe(6500);
    expect(result.by_asset_id.get("asset_1")).toBe(5000);
    expect(result.by_asset_id.has("asset_2")).toBe(false);
    expect(result.by_payee_id.get("payee_a")).toBe(5000);
    expect(result.by_payee_id.get("payee_b")).toBe(1500);
    expect(result.paid_items_count).toBe(3);
  });

  it("topN is deterministic for equal amounts (stable key ordering) and handles missing asset map", () => {
    const ranked = topN(
      new Map([
        ["payee_c", 1000],
        ["payee_a", 3000],
        ["payee_b", 3000]
      ]),
      3
    );

    expect(ranked[0]).toEqual({ key: "payee_a", amount_msat: 3000 });
    expect(ranked[1]).toEqual({ key: "payee_b", amount_msat: 3000 });
    expect(ranked[2]).toEqual({ key: "payee_c", amount_msat: 1000 });
  });
});
