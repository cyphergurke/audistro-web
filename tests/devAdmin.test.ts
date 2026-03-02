import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAllowedLNBitsBaseUrls,
  isDevAdminEnabled,
  parseAdminID,
  validateLNBitsBaseUrl
} from "../lib/devAdmin";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("devAdmin helpers", () => {
  it("validates admin IDs", () => {
    expect(parseAdminID("artist_id", "artist_1")).toBe("artist_1");
    expect(() => parseAdminID("artist_id", "bad id")).toThrow("artist_id is invalid");
  });

  it("enforces lnbits allowlist", () => {
    vi.stubEnv(
      "DEV_ADMIN_ALLOW_LNBITS_BASE_URLS",
      "http://lnbits:5000,http://localhost:5000,http://localhost:18090"
    );

    const allowed = getAllowedLNBitsBaseUrls();
    expect(allowed).toContain("http://lnbits:5000");
    expect(validateLNBitsBaseUrl("http://lnbits:5000")).toBe("http://lnbits:5000");
    expect(validateLNBitsBaseUrl("http://localhost:5000")).toBe("http://localhost:5000");
    expect(() => validateLNBitsBaseUrl("http://localhost:9999")).toThrow(
      "lnbits_base_url is not in allowlist"
    );
    expect(() => validateLNBitsBaseUrl("http://audicatalog:8080")).toThrow(
      "lnbits_base_url host is not allowed"
    );
  });

  it("requires the explicit dev-admin flag", () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_ADMIN", "true");
    expect(isDevAdminEnabled()).toBe(true);

    vi.stubEnv("NEXT_PUBLIC_DEV_ADMIN", "false");
    expect(isDevAdminEnabled()).toBe(false);
  });
});
