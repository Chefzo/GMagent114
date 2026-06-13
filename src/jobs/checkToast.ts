// Standalone Toast connectivity check. Run this from a machine/runner WITH
// network access (the dev sandbox blocks ws-api.toasttab.com) to confirm the
// Toast credentials work end to end:
//
//   npm run check:toast
//
// Step 1 authenticates with the client-credentials. Step 2 lists the
// restaurants the machine client can see — this PRINTS YOUR RESTAURANT GUID, so
// you can copy it into TOAST_RESTAURANT_GUID. Step 3 (only if that GUID is set)
// does a tiny read-only orders pull to prove data access. No writes, no emails.

import { requireEnv, env } from "../lib/config.ts";
import { log } from "../lib/logger.ts";

interface ToastLoginResponse {
  token: { accessToken: string; expiresIn: number; tokenType?: string };
}
interface ToastRestaurant {
  restaurantGuid?: string;
  restaurantName?: string;
  locationName?: string;
}

async function main(): Promise<void> {
  const baseUrl = env("TOAST_BASE_URL") ?? "https://ws-api.toasttab.com";

  // --- Step 1: authenticate -------------------------------------------------
  log.info(`Toast check: authenticating against ${baseUrl} ...`);
  const authRes = await fetch(`${baseUrl}/authentication/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: requireEnv("TOAST_CLIENT_ID"),
      clientSecret: requireEnv("TOAST_CLIENT_SECRET"),
      userAccessType: "TOAST_MACHINE_CLIENT",
    }),
  });
  if (!authRes.ok) {
    throw new Error(`Auth failed: ${authRes.status} ${await authRes.text()}`);
  }
  const { token } = (await authRes.json()) as ToastLoginResponse;
  log.info(`✓ Authenticated. Token expires in ${token.expiresIn}s.`);

  // --- Step 2: discover restaurant GUID(s) ---------------------------------
  log.info("Toast check: listing restaurants this client can access ...");
  const listRes = await fetch(`${baseUrl}/partners/v1/restaurants`, {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  });
  if (listRes.ok) {
    const restaurants = (await listRes.json()) as ToastRestaurant[];
    if (restaurants.length === 0) {
      log.warn("No restaurants returned. Confirm the location is mapped to this credential in the Toast dev portal ('Edit Location IDs').");
    }
    for (const r of restaurants) {
      const name = r.restaurantName ?? r.locationName ?? "(unnamed)";
      log.info(`  • ${name}  →  TOAST_RESTAURANT_GUID=${r.restaurantGuid ?? "(none)"}`);
    }
  } else {
    log.warn(`Could not list restaurants (${listRes.status}). You can also find the GUID in the dev portal under 'Edit Location IDs'.`);
  }

  // --- Step 3: prove data access (only if a GUID is configured) ------------
  const guid = env("TOAST_RESTAURANT_GUID");
  if (!guid) {
    log.info("TOAST_RESTAURANT_GUID is not set yet — copy one of the GUIDs above into your .env / GitHub secret, then re-run to verify data access.");
    return;
  }
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const url =
    `${baseUrl}/orders/v2/ordersBulk` +
    `?startDate=${encodeURIComponent(since)}&endDate=${encodeURIComponent(new Date().toISOString())}&pageSize=1&page=1`;
  const ordersRes = await fetch(url, {
    headers: { Authorization: `Bearer ${token.accessToken}`, "Toast-Restaurant-External-ID": guid },
  });
  if (!ordersRes.ok) {
    throw new Error(`Orders read failed: ${ordersRes.status} ${await ordersRes.text()} (check the GUID and that the Orders scope is granted)`);
  }
  const orders = (await ordersRes.json()) as unknown[];
  log.info(`✓ Orders API reachable for GUID ${guid}. (${orders.length} order(s) in the last 24h sample.)`);
  log.info("Toast is fully wired up. 🎉");
}

main().catch((err) => {
  log.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
