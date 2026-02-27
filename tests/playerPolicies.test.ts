import { describe, expect, it } from "vitest";
import { decidePlaybackAction } from "../lib/playerPolicies";
import type { PlayerError } from "../lib/playerTypes";

function buildError(overrides: Partial<PlayerError>): PlayerError {
  return {
    kind: "other",
    type: "networkError",
    details: "GENERIC_ERROR",
    fatal: true,
    providerId: "provider-a",
    timestamp: Date.now(),
    ...overrides
  } as PlayerError;
}

describe("decidePlaybackAction", () => {
  it("requests token refresh on key 401", () => {
    const decision = decidePlaybackAction({
      consecutiveFragmentFailures: 0,
      error: buildError({
        kind: "key",
        details: "KEY_LOAD_ERROR",
        responseCode: 401,
        url: "https://fap.example/hls/asset/key"
      })
    });

    expect(decision.shouldRefreshToken).toBe(true);
    expect(decision.shouldSwitchProvider).toBe(false);
    expect(decision.rule).toBe("key_unauthorized");
  });

  it("switches provider on manifest failures", () => {
    const decision = decidePlaybackAction({
      consecutiveFragmentFailures: 0,
      error: buildError({
        kind: "manifest",
        details: "MANIFEST_LOAD_TIMEOUT"
      })
    });

    expect(decision.shouldSwitchProvider).toBe(true);
    expect(decision.rule).toBe("manifest_fail");
  });

  it("switches provider after two consecutive fragment load failures", () => {
    const first = decidePlaybackAction({
      consecutiveFragmentFailures: 0,
      error: buildError({
        kind: "fragment",
        details: "FRAG_LOAD_TIMEOUT",
        fatal: false
      })
    });
    expect(first.shouldSwitchProvider).toBe(false);
    expect(first.nextConsecutiveFragmentFailures).toBe(1);

    const second = decidePlaybackAction({
      consecutiveFragmentFailures: first.nextConsecutiveFragmentFailures,
      error: buildError({
        kind: "fragment",
        details: "FRAG_LOAD_ERROR",
        fatal: false
      })
    });
    expect(second.shouldSwitchProvider).toBe(true);
    expect(second.rule).toBe("segment_fail");
  });

  it("switches provider immediately on segment 404/5xx", () => {
    const decision = decidePlaybackAction({
      consecutiveFragmentFailures: 0,
      error: buildError({
        kind: "fragment",
        details: "FRAG_LOAD_ERROR",
        responseCode: 404,
        fatal: false
      })
    });

    expect(decision.shouldSwitchProvider).toBe(true);
    expect(decision.rule).toBe("segment_fail");
  });

  it("counts fragment parsing errors before switching providers", () => {
    const first = decidePlaybackAction({
      consecutiveFragmentFailures: 0,
      error: buildError({
        kind: "fragment",
        details: "fragParsingError",
        fatal: false
      })
    });

    expect(first.shouldSwitchProvider).toBe(false);
    expect(first.nextConsecutiveFragmentFailures).toBe(1);

    const second = decidePlaybackAction({
      consecutiveFragmentFailures: first.nextConsecutiveFragmentFailures,
      error: buildError({
        kind: "fragment",
        details: "fragParsingError",
        fatal: false
      })
    });

    expect(second.shouldSwitchProvider).toBe(true);
    expect(second.rule).toBe("segment_fail");
  });
});
