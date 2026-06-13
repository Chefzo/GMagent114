// Authentication for the three live integrations: Google (service account JWT
// -> OAuth access token), Toast (OAuth2 client-credentials + restaurant GUID),
// and Sling (OAuth2 token bound to an admin login). All use built-in fetch and
// node:crypto so the project has no auth-library dependency.

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { env, requireEnv } from "./config.ts";
import { log } from "./logger.ts";

// ---- token cache -----------------------------------------------------------
interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}
const cache = new Map<string, CachedToken>();

function fresh(key: string): string | undefined {
  const c = cache.get(key);
  if (c && c.expiresAt - 60_000 > Date.now()) return c.token;
  return undefined;
}

function store(key: string, token: string, ttlSeconds: number): void {
  cache.set(key, { token, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ---- Google service account -> access token --------------------------------
interface GoogleKey {
  client_email: string;
  private_key: string;
}

function loadGoogleKey(): GoogleKey {
  const inline = env("GOOGLE_SERVICE_ACCOUNT_JSON");
  const raw = inline ?? readFileSync(requireEnv("GOOGLE_SERVICE_ACCOUNT_FILE"), "utf8");
  const parsed = JSON.parse(raw) as GoogleKey;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Google service-account key missing client_email/private_key");
  }
  return parsed;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Mints a Google OAuth access token via the service-account JWT-bearer flow.
 * `scopes` selects Sheets/Gmail/Calendar access; `subject` impersonates a user
 * (needed for Gmail/Calendar via domain-wide delegation).
 */
export async function googleAccessToken(scopes: string[], subject?: string): Promise<string> {
  const cacheKey = `google:${subject ?? "-"}:${scopes.join(",")}`;
  const hit = fresh(cacheKey);
  if (hit) return hit;

  const key = loadGoogleKey();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: scopes.join(" "),
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      ...(subject ? { sub: subject } : {}),
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = base64url(signer.sign(key.private_key));
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Google token failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  store(cacheKey, json.access_token, json.expires_in);
  return json.access_token;
}

// ---- Toast OAuth2 client-credentials --------------------------------------
export interface ToastAuth {
  token: string;
  restaurantGuid: string;
  baseUrl: string;
}

export async function toastAuth(): Promise<ToastAuth> {
  const baseUrl = env("TOAST_BASE_URL") ?? "https://ws-api.toasttab.com";
  const restaurantGuid = requireEnv("TOAST_RESTAURANT_GUID");
  const hit = fresh("toast");
  if (hit) return { token: hit, restaurantGuid, baseUrl };

  const res = await fetch(`${baseUrl}/authentication/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: requireEnv("TOAST_CLIENT_ID"),
      clientSecret: requireEnv("TOAST_CLIENT_SECRET"),
      userAccessType: "TOAST_MACHINE_CLIENT",
    }),
  });
  if (!res.ok) throw new Error(`Toast auth failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { token: { accessToken: string; expiresIn: number } };
  store("toast", json.token.accessToken, json.token.expiresIn);
  return { token: json.token.accessToken, restaurantGuid, baseUrl };
}

// ---- Sling OAuth2 token (bound to admin login) -----------------------------
export interface SlingAuth {
  token: string;
  baseUrl: string;
}

export async function slingAuth(): Promise<SlingAuth> {
  const baseUrl = env("SLING_BASE_URL") ?? "https://api.getsling.com";

  // A long-lived token can be supplied directly.
  const direct = env("SLING_API_TOKEN");
  if (direct) return { token: direct, baseUrl };

  const hit = fresh("sling");
  if (hit) return { token: hit, baseUrl };

  const res = await fetch(`${baseUrl}/v1/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: requireEnv("SLING_EMAIL"), password: requireEnv("SLING_PASSWORD") }),
  });
  if (!res.ok) throw new Error(`Sling auth failed: ${res.status} ${await res.text()}`);
  // Sling returns the bearer in the Authorization response header.
  const token = res.headers.get("authorization") ?? "";
  if (!token) throw new Error("Sling auth: no authorization token in response");
  store("sling", token, 3000); // re-login well before the ~3600s expiry
  log.debug("Sling token acquired via login");
  return { token, baseUrl };
}
