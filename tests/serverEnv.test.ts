import { afterEach, describe, expect, it } from "vitest";
import { assertServerRuntimeEnv, resetServerRuntimeEnvForTest } from "@/src/server/env";

describe("server runtime env", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetServerRuntimeEnvForTest();
  });

  it("skips validation outside prod", () => {
    process.env.AUDISTRO_ENV = "dev";

    expect(() => assertServerRuntimeEnv()).not.toThrow();
  });

  it("fails on missing required prod env", () => {
    process.env.AUDISTRO_ENV = "prod";
    delete process.env.CATALOG_BASE_URLS;
    process.env.FAP_BASE_URL = "http://audistro-fap:8080";
    process.env.NEXT_PUBLIC_FAP_PUBLIC_BASE_URL = "https://api.example.com/fap";

    expect(() => assertServerRuntimeEnv()).toThrow("envcheck: missing required env: CATALOG_BASE_URLS");
  });

  it("accepts valid prod env", () => {
    process.env.AUDISTRO_ENV = "prod";
    process.env.CATALOG_BASE_URLS = "http://audistro-catalog:8080,http://audistro-catalog-mirror:8080";
    process.env.FAP_BASE_URL = "http://audistro-fap:8080";
    process.env.NEXT_PUBLIC_FAP_PUBLIC_BASE_URL = "https://api.example.com/fap";

    expect(() => assertServerRuntimeEnv()).not.toThrow();
  });
});
