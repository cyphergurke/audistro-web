import { describe, expect, it } from "vitest";
import {
  buildAccessSubject,
  classifyTokenExchangeConflict,
  isPayeeNotFoundResponse,
  isDevModeDisabledResponse,
  shouldFallbackToChallengeFlow,
  parseChallengeId,
  parseChallengeStartResponse,
  parseDevAccessResponse,
  parseTokenExchangeSuccess
} from "../lib/accessServer";

describe("accessServer helpers", () => {
  it("parses dev access responses", () => {
    const parsed = parseDevAccessResponse(
      JSON.stringify({
        asset_id: "asset2",
        access_token: "token-1",
        expires_at: 1773000000
      })
    );
    expect(parsed.mode).toBe("dev");
    expect(parsed.asset_id).toBe("asset2");
    expect(parsed.access_token).toBe("token-1");
    expect(parsed.expires_at).toBe(1773000000);
  });

  it("parses challenge and token exchange payloads", () => {
    const challenge = parseChallengeStartResponse(
      JSON.stringify({
        challenge_id: "abcd1234",
        bolt11: "lnbc123",
        expires_at: 1773000000,
        amount_msat: 1000
      })
    );
    expect(challenge.mode).toBe("invoice");
    expect(challenge.challenge_id).toBe("abcd1234");

    const paid = parseTokenExchangeSuccess(
      JSON.stringify({
        token: "access-1",
        expires_at: 1773000001,
        resource_id: "hls:key:asset2"
      })
    );
    expect(paid.status).toBe("paid");
    if (paid.status === "paid") {
      expect(paid.access_token).toBe("access-1");
    }
  });

  it("classifies conflict responses for polling", () => {
    expect(classifyTokenExchangeConflict(`{"error":"payment not settled"}`)).toEqual({
      status: "pending"
    });
    expect(classifyTokenExchangeConflict(`{"error":"intent expired"}`)).toEqual({
      status: "expired",
      error: "intent expired"
    });
    expect(classifyTokenExchangeConflict(`{"error":"something else"}`)).toEqual({
      status: "failed",
      error: "something else"
    });
  });

  it("validates challenge identifiers and dev-disabled responses", () => {
    expect(parseChallengeId("abc_123")).toBe("abc_123");
    expect(() => parseChallengeId("")).toThrow("challengeId is invalid");
    expect(buildAccessSubject("asset2")).toBe("web:asset2");
    expect(isDevModeDisabledResponse(403, `{"error":"dev_mode_disabled"}`)).toBe(true);
    expect(isDevModeDisabledResponse(400, `{"error":"dev_mode_disabled"}`)).toBe(false);
    expect(shouldFallbackToChallengeFlow(404, `{"error":"not found: asset"}`)).toBe(true);
    expect(shouldFallbackToChallengeFlow(404, `{"error":"asset not found"}`)).toBe(true);
    expect(shouldFallbackToChallengeFlow(500, `{"error":"internal"}`)).toBe(false);
    expect(isPayeeNotFoundResponse(404, `{"error":"not found: payee"}`)).toBe(true);
    expect(isPayeeNotFoundResponse(400, `{"error":"payee not found"}`)).toBe(true);
    expect(isPayeeNotFoundResponse(500, `{"error":"payee not found"}`)).toBe(false);
  });
});
