import type { PlayerError } from "./playerTypes";
import { isUnauthorizedKeyError } from "./playerErrorClassifier";

export type FallbackRule = "manifest_fail" | "segment_fail" | "key_unauthorized";

export type PlaybackDecision = {
  shouldSwitchProvider: boolean;
  shouldRefreshToken: boolean;
  nextConsecutiveFragmentFailures: number;
  rule?: FallbackRule;
  reason?: string;
};

function isFragmentHttpFailure(code: number | undefined): boolean {
  if (typeof code !== "number") {
    return false;
  }
  return code >= 404 && code <= 599;
}

export function decidePlaybackAction(args: {
  error: PlayerError;
  consecutiveFragmentFailures: number;
}): PlaybackDecision {
  const { error, consecutiveFragmentFailures } = args;

  if (isUnauthorizedKeyError(error)) {
    return {
      shouldSwitchProvider: false,
      shouldRefreshToken: true,
      nextConsecutiveFragmentFailures: 0,
      rule: "key_unauthorized",
      reason: "key unauthorized"
    };
  }

  if (error.kind === "manifest") {
    return {
      shouldSwitchProvider: true,
      shouldRefreshToken: false,
      nextConsecutiveFragmentFailures: 0,
      rule: "manifest_fail",
      reason: "manifest fail"
    };
  }

  if (error.kind === "fragment") {
    if (isFragmentHttpFailure(error.responseCode)) {
      return {
        shouldSwitchProvider: true,
        shouldRefreshToken: false,
        nextConsecutiveFragmentFailures: 0,
        rule: "segment_fail",
        reason: "segment fail (404/5xx)"
      };
    }

    const nextFailures = consecutiveFragmentFailures + 1;
    if (nextFailures >= 2) {
      return {
        shouldSwitchProvider: true,
        shouldRefreshToken: false,
        nextConsecutiveFragmentFailures: 0,
        rule: "segment_fail",
        reason: "segment fail (>=2 consecutive fragment errors)"
      };
    }

    return {
      shouldSwitchProvider: false,
      shouldRefreshToken: false,
      nextConsecutiveFragmentFailures: nextFailures
    };
  }

  return {
    shouldSwitchProvider: false,
    shouldRefreshToken: false,
    nextConsecutiveFragmentFailures: 0
  };
}
