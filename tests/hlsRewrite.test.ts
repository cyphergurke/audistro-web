import { describe, expect, it } from "vitest";
import { rewriteKeyUri } from "../lib/hlsRewrite";

describe("rewriteKeyUri", () => {
  it("replaces URI in AES-128 EXT-X-KEY", () => {
    const playlist = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="http://old/key"',
      "#EXTINF:2.0,",
      "seg_0000.ts"
    ].join("\n");

    const out = rewriteKeyUri(playlist, "http://new/key?token=abc");

    expect(out).toContain('URI="http://new/key?token=abc"');
    expect(out).not.toContain('URI="http://old/key"');
  });

  it("keeps playlist unchanged when no EXT-X-KEY exists", () => {
    const playlist = ["#EXTM3U", "#EXTINF:2.0,", "seg_0000.ts"].join("\n");

    const out = rewriteKeyUri(playlist, "http://new/key");

    expect(out).toBe(playlist);
  });
});
