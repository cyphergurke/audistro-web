import { describe, expect, it } from "vitest";
import {
  extractBoostContextFromPlayback,
  parseAmountSats,
  parseAssetId,
  parseBoostListLimit,
  parseBoostId,
  parseIdempotencyKey
} from "../lib/boostServer";
import type { PlaybackResponse } from "../lib/types";

function buildPlayback(overrides?: Partial<PlaybackResponse>): PlaybackResponse {
  return {
    now: 1700000000,
    asset: {
      asset_id: "asset_boost_1",
      pay: {
        fap_url: "http://localhost:18081",
        fap_payee_id: "fap_payee_1",
        payee_id: "payee_internal_1"
      }
    },
    providers: [],
    ...overrides
  };
}

describe("boostServer helpers", () => {
  it("validates ids and amount bounds", () => {
    expect(parseAssetId("asset_1")).toBe("asset_1");
    expect(() => parseAssetId("")).toThrow("assetId is invalid");
    expect(parseBoostId("boost-1")).toBe("boost-1");
    expect(() => parseBoostId("bad id")).toThrow("boostId is invalid");
    expect(parseAmountSats(1000)).toBe(1000);
    expect(() => parseAmountSats(0)).toThrow("amountSats must be 1..50000");
    expect(() => parseAmountSats(50001)).toThrow("amountSats must be 1..50000");
    expect(parseIdempotencyKey("ab12cd34")).toBe("ab12cd34");
    expect(() => parseIdempotencyKey("%%%")).toThrow("idempotencyKey is invalid");
    expect(parseBoostListLimit(null)).toBe(20);
    expect(parseBoostListLimit("10")).toBe(10);
    expect(parseBoostListLimit("999")).toBe(100);
    expect(() => parseBoostListLimit("0")).toThrow("limit must be a positive integer");
  });

  it("extracts trusted boost context from playback pay hints", () => {
    const playback = buildPlayback();
    const context = extractBoostContextFromPlayback("asset_boost_1", playback);

    expect(context.assetId).toBe("asset_boost_1");
    expect(context.fapUrl).toBe("http://localhost:18081");
    expect(context.fapPayeeId).toBe("fap_payee_1");
    expect(context.payeeId).toBe("payee_internal_1");
  });

  it("rejects invalid/missing playback pay hints (SSRF guard basis)", () => {
    expect(() =>
      extractBoostContextFromPlayback(
        "asset_boost_1",
        buildPlayback({
          asset: {
            asset_id: "asset_boost_1",
            pay: {
              fap_url: "ftp://evil.example",
              fap_payee_id: "fap_payee_1",
              payee_id: "payee_internal_1"
            }
          }
        })
      )
    ).toThrow("catalog playback fap_url must be http/https");

    expect(() =>
      extractBoostContextFromPlayback(
        "asset_boost_1",
        buildPlayback({
          asset: {
            asset_id: "asset_boost_1",
            pay: {
              fap_url: "",
              fap_payee_id: "fap_payee_1",
              payee_id: "payee_internal_1"
            }
          }
        })
      )
    ).toThrow("catalog playback pay hints incomplete");
  });
});
