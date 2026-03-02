import envSchema from "../../ops/env.schema.json";

type EnvSchemaKey = {
  key: string;
  required_in_prod: boolean;
  pattern: string;
  redact: boolean;
};

type EnvSchema = {
  service: string;
  keys: EnvSchemaKey[];
};

const schema = envSchema as EnvSchema;

let validated = false;

function validateURLList(name: string, value: string): void {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`envcheck: invalid env: ${name}`);
  }
  for (const part of parts) {
    try {
      const parsed = new URL(part);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
    } catch {
      throw new Error(`envcheck: invalid env: ${name}`);
    }
  }
}

function validateSingleURL(name: string, value: string): void {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error(`envcheck: invalid env: ${name}`);
  }
}

function validateWithSchema(entry: EnvSchemaKey, value: string): void {
  const pattern = new RegExp(entry.pattern);
  if (!pattern.test(value)) {
    throw new Error(`envcheck: invalid env: ${entry.key}`);
  }
  if (entry.key === "CATALOG_BASE_URLS") {
    validateURLList(entry.key, value);
    return;
  }
  if (entry.key.endsWith("_BASE_URL") || entry.key.endsWith("_PUBLIC_BASE_URL")) {
    validateSingleURL(entry.key, value);
  }
}

export function assertServerRuntimeEnv(): void {
  if (validated) {
    return;
  }

  const mode = (process.env.AUDISTRO_ENV ?? "").trim();
  if (mode === "") {
    return;
  }
  if (mode !== "prod" && mode !== "dev" && mode !== "test") {
    throw new Error("envcheck: invalid env: AUDISTRO_ENV");
  }
  if (mode !== "prod") {
    validated = true;
    return;
  }

  for (const entry of schema.keys) {
    if (!entry.required_in_prod) {
      continue;
    }
    const value = process.env[entry.key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`envcheck: missing required env: ${entry.key}`);
    }
    validateWithSchema(entry, value);
  }

  validated = true;
}

export function resetServerRuntimeEnvForTest(): void {
  validated = false;
}
