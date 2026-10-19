import { config } from "../config.js";

export function isAllowedClientOrigin(
  origin: string | undefined,
  environment: string,
  configuredOrigin: string
): boolean {
  if (origin === configuredOrigin) return true;
  if (environment !== "development" || !origin) return false;
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function allowClientOrigin(origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void): void {
  callback(null, isAllowedClientOrigin(origin, config.NODE_ENV, config.CLIENT_ORIGIN));
}
