import { fetchCatalogGET } from "@/lib/catalogServer";
import { getServerEnv } from "@/lib/env";
import { rewriteKeyUri } from "@/lib/hlsRewrite";
import type { PlaybackResponse, ProviderHint } from "@/lib/types";

export const dynamic = "force-dynamic";

const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const minTokenLength = 16;
const maxTokenLength = 4096;
const playlistTimeoutMs = 5000;
const maxQueryLength = 5000;

type RouteContext = {
  params: Promise<{
    assetId: string;
  }>;
};

type FetchError = {
  message: string;
  status: number;
};

type PlaylistFetchResult = {
  text: string;
  contentType: string;
  fetchedFrom: URL;
};

function parseId(name: string, value: string): string {
  const trimmed = value.trim();
  if (!idPattern.test(trimmed)) {
    throw new Error(`${name} is invalid`);
  }
  return trimmed;
}

function parseToken(rawToken: string): string {
  const token = rawToken.trim();
  if (token.length < minTokenLength || token.length > maxTokenLength) {
    throw new Error("token length is invalid");
  }
  return token;
}

function parsePlayback(payloadText: string): PlaybackResponse {
  const parsed = JSON.parse(payloadText) as PlaybackResponse;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.providers)) {
    throw new Error("catalog playback response is invalid");
  }
  return parsed;
}

function buildMasterPlaylistUrl(providerBase: string, assetId: string): URL {
  const base = new URL(providerBase);
  const normalizedPath = base.pathname.replace(/\/+$/, "");
  const assetSuffix = `/assets/${assetId}`;
  const playlistPath = normalizedPath.endsWith(assetSuffix)
    ? `${normalizedPath}/master.m3u8`
    : `${normalizedPath}${assetSuffix}/master.m3u8`;

  const playlistUrl = new URL(base.toString());
  playlistUrl.pathname = playlistPath;
  playlistUrl.search = "";
  playlistUrl.hash = "";
  return playlistUrl;
}

function absolutizeMediaUris(playlistText: string, playlistUrl: URL): string {
  return playlistText
    .split(/\r?\n/)
    .map((line) => {
      if (line.trim() === "" || line.startsWith("#")) {
        return line;
      }
      return new URL(line, playlistUrl).toString();
    })
    .join("\n");
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout)
  };
}

async function fetchText(
  url: URL,
  timeoutMs: number
): Promise<{ status: number; text: string; contentType: string }> {
  const { signal, cleanup } = withTimeoutSignal(timeoutMs);
  try {
    const upstream = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      signal
    });

    return {
      status: upstream.status,
      text: await upstream.text(),
      contentType: upstream.headers.get("content-type") ?? "text/plain"
    };
  } finally {
    cleanup();
  }
}

async function fetchPlaybackFromCatalog(
  assetId: string
): Promise<PlaybackResponse> {
  const result = await fetchCatalogGET(`/v1/playback/${encodeURIComponent(assetId)}`, playlistTimeoutMs);
  if (result.status !== 200) {
    throw {
      message: result.text || "failed to fetch playback from catalog",
      status: result.status
    } satisfies FetchError;
  }
  return parsePlayback(result.text);
}

function resolveTrustedProvider(
  playback: PlaybackResponse,
  providerId: string
): ProviderHint | null {
  return playback.providers.find((provider) => provider.provider_id === providerId) ?? null;
}

function buildCandidatePlaylistUrls(
  publicPlaylistUrl: URL,
  providerInternalBaseUrl: string
): URL[] {
  const candidates: URL[] = [publicPlaylistUrl];
  const isLocalhost =
    publicPlaylistUrl.hostname === "localhost" || publicPlaylistUrl.hostname === "127.0.0.1";

  if (isLocalhost) {
    const internalBase = new URL(providerInternalBaseUrl);
    const internalPlaylistUrl = new URL(publicPlaylistUrl.toString());
    internalPlaylistUrl.protocol = internalBase.protocol;
    internalPlaylistUrl.hostname = internalBase.hostname;
    internalPlaylistUrl.port = internalBase.port;
    candidates.push(internalPlaylistUrl);
  }

  return candidates;
}

async function fetchTrustedPlaylist(
  publicPlaylistUrl: URL,
  providerInternalBaseUrl: string
): Promise<PlaylistFetchResult> {
  const candidates = buildCandidatePlaylistUrls(publicPlaylistUrl, providerInternalBaseUrl);

  let lastError: Error | null = null;
  let lastResponse: { status: number; text: string; contentType: string } | null = null;

  for (const candidate of candidates) {
    try {
      const result = await fetchText(candidate, playlistTimeoutMs);
      if (result.status === 200) {
        return {
          text: result.text,
          contentType: result.contentType,
          fetchedFrom: candidate
        };
      }
      lastResponse = result;
    } catch (err: unknown) {
      if (err instanceof Error) {
        lastError = err;
      } else {
        lastError = new Error("unknown playlist fetch failure");
      }
    }
  }

  if (lastResponse) {
    throw {
      message: lastResponse.text || "provider playlist fetch failed",
      status: lastResponse.status
    } satisfies FetchError;
  }

  throw {
    message: lastError?.message ?? "provider playlist fetch failed",
    status: 502
  } satisfies FetchError;
}

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { providerInternalBaseUrl } = getServerEnv();
    const { assetId: rawAssetId } = await params;
    const assetId = parseId("assetId", rawAssetId);

    const requestUrl = new URL(req.url);
    if (requestUrl.search.length > maxQueryLength) {
      throw new Error("query string is too long");
    }

    const providerIdRaw = requestUrl.searchParams.get("providerId")?.trim() ?? "";
    if (providerIdRaw.length > 128) {
      throw new Error("providerId length is invalid");
    }
    const providerId = parseId("providerId", providerIdRaw);

    const tokenRaw = requestUrl.searchParams.get("token")?.trim() ?? "";
    if (tokenRaw.length > maxTokenLength) {
      throw new Error("token length is invalid");
    }
    const token = parseToken(tokenRaw);

    const playback = await fetchPlaybackFromCatalog(assetId);
    const provider = resolveTrustedProvider(playback, providerId);
    if (!provider) {
      return Response.json(
        { error: "providerId is not available for this asset" },
        { status: 400 }
      );
    }

    const publicPlaylistUrl = buildMasterPlaylistUrl(provider.base_url, assetId);
    const playlistResult = await fetchTrustedPlaylist(publicPlaylistUrl, providerInternalBaseUrl);

    let playlistText = absolutizeMediaUris(playlistResult.text, publicPlaylistUrl);
    const rewrittenKeyUrl = `/api/hls-key/${encodeURIComponent(assetId)}?token=${encodeURIComponent(token)}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "no-store",
      "X-Playlist-Upstream": playlistResult.fetchedFrom.toString()
    };
    playlistText = rewriteKeyUri(playlistText, rewrittenKeyUrl);

    return new Response(playlistText, {
      status: 200,
      headers
    });
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "status" in err && "message" in err) {
      const failure = err as FetchError;
      return Response.json({ error: failure.message }, { status: failure.status });
    }

    if (err instanceof Error) {
      return Response.json({ error: err.message }, { status: 400 });
    }

    return Response.json({ error: "playlist route failed" }, { status: 500 });
  }
}
