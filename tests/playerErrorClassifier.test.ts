import { describe, expect, it } from "vitest";
import { ErrorDetails, ErrorTypes, type ErrorData } from "hls.js";
import { classifyHlsError, isUnauthorizedKeyError } from "../lib/playerErrorClassifier";

function buildErrorData(overrides: Partial<ErrorData>): ErrorData {
  return {
    type: ErrorTypes.NETWORK_ERROR,
    details: ErrorDetails.MANIFEST_LOAD_ERROR,
    fatal: true,
    ...overrides
  } as ErrorData;
}

describe("classifyHlsError", () => {
  it("classifies key unauthorized errors and sanitizes URL", () => {
    const classified = classifyHlsError({
      providerId: "provider-a",
      now: 1711111111,
      data: buildErrorData({
        details: ErrorDetails.KEY_LOAD_ERROR,
        response: {
          code: 401,
          url: "https://fap.example/hls/asset/key?token=secret-token"
        } as unknown as ErrorData["response"]
      })
    });

    expect(classified.kind).toBe("key");
    expect(classified.responseCode).toBe(401);
    expect(classified.url).toBe("https://fap.example/hls/asset/key");
    expect(isUnauthorizedKeyError(classified)).toBe(true);
  });

  it("classifies fragment timeout errors", () => {
    const classified = classifyHlsError({
      providerId: "provider-b",
      data: buildErrorData({
        details: ErrorDetails.FRAG_LOAD_TIMEOUT,
        fatal: false
      })
    });

    expect(classified.kind).toBe("fragment");
    expect(classified.fatal).toBe(false);
  });

  it("classifies fragment parsing errors", () => {
    const classified = classifyHlsError({
      providerId: "provider-e",
      data: buildErrorData({
        type: ErrorTypes.MEDIA_ERROR,
        details: "fragParsingError" as ErrorData["details"],
        fatal: false
      })
    });

    expect(classified.kind).toBe("fragment");
    expect(classified.fatal).toBe(false);
  });

  it("classifies manifest load timeout errors", () => {
    const classified = classifyHlsError({
      providerId: "provider-c",
      data: buildErrorData({
        details: ErrorDetails.MANIFEST_LOAD_TIMEOUT
      })
    });

    expect(classified.kind).toBe("manifest");
  });

  it("classifies media buffering errors", () => {
    const classified = classifyHlsError({
      providerId: "provider-d",
      data: buildErrorData({
        type: ErrorTypes.MEDIA_ERROR,
        details: "bufferStalledError" as ErrorData["details"],
        fatal: false
      })
    });

    expect(classified.kind).toBe("media");
  });
});
