import { assertServerRuntimeEnv } from "./src/server/env";

export async function register(): Promise<void> {
  assertServerRuntimeEnv();
}
