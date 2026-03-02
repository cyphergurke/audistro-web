import { describe, expect, it } from "vitest";
import {
  absolutizePlaylistReference,
  createEncryptedPreflightSteps,
  extractEncryptedKeyUri,
  extractFirstMediaReference
} from "../lib/encryptedPlaybackPreflight";

describe("encryptedPlaybackPreflight helpers", () => {
  it("creates the expected step order", () => {
    expect(createEncryptedPreflightSteps().map((item) => item.id)).toEqual([
      "playback",
      "token",
      "playlist",
      "key",
      "segment",
      "fallback"
    ]);
  });

  it("extracts the AES-128 key URI from a playlist", () => {
    const playlist = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="/api/hls-key/asset1?token=abc",IV=0x1234',
      "#EXTINF:4.0,",
      "seg_0000.ts"
    ].join("\n");

    expect(extractEncryptedKeyUri(playlist)).toBe("/api/hls-key/asset1?token=abc");
  });

  it("returns null when no key line exists", () => {
    expect(extractEncryptedKeyUri("#EXTM3U\n#EXTINF:4.0,\nseg_0000.ts")).toBeNull();
  });

  it("extracts the first media reference", () => {
    const playlist = ["#EXTM3U", "#EXTINF:4.0,", "seg_0000.ts", "seg_0001.ts"].join("\n");
    expect(extractFirstMediaReference(playlist)).toBe("seg_0000.ts");
  });

  it("absolutizes relative playlist references", () => {
    expect(
      absolutizePlaylistReference(
        "seg_0000.ts",
        "http://localhost:3000/api/playlist/asset1?providerId=p1&token=abc"
      )
    ).toBe("http://localhost:3000/api/playlist/seg_0000.ts");
  });

  it("keeps absolute references absolute", () => {
    expect(
      absolutizePlaylistReference(
        "http://localhost:18082/assets/asset1/seg_0000.ts",
        "http://localhost:3000/api/playlist/asset1?providerId=p1&token=abc"
      )
    ).toBe("http://localhost:18082/assets/asset1/seg_0000.ts");
  });
});
