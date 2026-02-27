import { describe, expect, it } from "vitest";
import { aggregatePaidEntries, buildTopAssets, buildTopPayees } from "../lib/ledger";
import type { LedgerEntry } from "../lib/types";

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    entry_id: "entry_default",
    kind: "access",
    status: "paid",
    payee_id: "payee_1",
    amount_msat: 1000,
    currency: "msat",
    created_at: 1700000000,
    updated_at: 1700000000,
    paid_at: 1700000001,
    ...overrides
  };
}

describe("spend aggregation", () => {
  it("aggregates paid entries by kind, asset and payee", () => {
    const items: LedgerEntry[] = [
      entry({
        entry_id: "a1",
        kind: "access",
        amount_msat: 2000,
        payee_id: "payee_a",
        asset_id: "asset_1"
      }),
      entry({
        entry_id: "a2",
        kind: "boost",
        amount_msat: 5000,
        payee_id: "payee_a",
        asset_id: "asset_1"
      }),
      entry({
        entry_id: "a3",
        kind: "boost",
        amount_msat: 3000,
        payee_id: "payee_b",
        asset_id: "asset_2"
      }),
      entry({
        entry_id: "a4",
        kind: "access",
        status: "pending",
        amount_msat: 9000,
        payee_id: "payee_c",
        asset_id: "asset_3"
      })
    ];

    const aggregation = aggregatePaidEntries(items);
    expect(aggregation.totals.total_paid_msat_access).toBe(2000);
    expect(aggregation.totals.total_paid_msat_boost).toBe(8000);
    expect(aggregation.totals.total_paid_msat_all).toBe(10_000);
    expect(aggregation.byAssetID.get("asset_1")).toBe(7000);
    expect(aggregation.byAssetID.get("asset_2")).toBe(3000);
    expect(aggregation.byPayeeID.get("payee_a")).toBe(7000);
    expect(aggregation.byPayeeID.get("payee_b")).toBe(3000);
    expect(aggregation.byPayeeID.has("payee_c")).toBe(false);
    expect(aggregation.paidItemsCount).toBe(3);
  });

  it("builds top assets and top payees sorted by amount", () => {
    const topAssets = buildTopAssets(
      new Map([
        ["asset_1", 8000],
        ["asset_2", 5000]
      ]),
      new Map([
        ["asset_1", { asset_id: "asset_1", title: "Song A", artist_handle: "artist_a" }],
        ["asset_2", { asset_id: "asset_2", title: "Song B", artist_handle: "artist_b" }]
      ])
    );
    expect(topAssets[0]?.asset_id).toBe("asset_1");
    expect(topAssets[0]?.title).toBe("Song A");
    expect(topAssets[1]?.asset_id).toBe("asset_2");

    const topPayees = buildTopPayees(
      new Map([
        ["payee_a", 7000],
        ["payee_b", 2000]
      ]),
      new Map([["payee_a", { artist_handle: "artist_a", artist_display_name: "Artist A" }]])
    );
    expect(topPayees[0]?.payee_id).toBe("payee_a");
    expect(topPayees[0]?.artist_handle).toBe("artist_a");
    expect(topPayees[1]?.payee_id).toBe("payee_b");
  });
});
