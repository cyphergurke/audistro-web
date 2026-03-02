export type ServerEnv = {
  catalogBaseUrl: string;
  fapBaseUrl: string;
  catalogInternalBaseUrl: string;
  fapInternalBaseUrl: string;
  providerInternalBaseUrl: string;
  catalogAdminToken: string;
};

let cachedEnv: ServerEnv | null = null;

function parseUrl(name: string, value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`${name} must use http or https`);
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} is not a valid URL: ${value}`);
  }
}

export function getServerEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const rawCatalog =
    process.env.CATALOG_BASE_URL ??
    process.env.NEXT_PUBLIC_CATALOG_BASE_URL ??
    "http://localhost:18080";
  const rawCatalogInternal = process.env.CATALOG_INTERNAL_BASE_URL ?? rawCatalog;
  const rawFap =
    process.env.FAP_BASE_URL ?? process.env.NEXT_PUBLIC_FAP_BASE_URL ?? "http://localhost:18081";
  const rawFapInternal = process.env.FAP_INTERNAL_BASE_URL ?? rawFap;
  const rawProviderInternal =
    process.env.PROVIDER_INTERNAL_BASE_URL ??
    process.env.NEXT_PUBLIC_PROVIDER_INTERNAL_BASE_URL ??
    "http://localhost:18082";

  cachedEnv = {
    catalogBaseUrl: parseUrl("CATALOG_BASE_URL", rawCatalog),
    fapBaseUrl: parseUrl("FAP_BASE_URL", rawFap),
    catalogInternalBaseUrl: parseUrl("CATALOG_INTERNAL_BASE_URL", rawCatalogInternal),
    fapInternalBaseUrl: parseUrl("FAP_INTERNAL_BASE_URL", rawFapInternal),
    providerInternalBaseUrl: parseUrl("PROVIDER_INTERNAL_BASE_URL", rawProviderInternal),
    catalogAdminToken: (process.env.CATALOG_ADMIN_TOKEN ?? "dev-admin-token").trim()
  };

  return cachedEnv;
}
