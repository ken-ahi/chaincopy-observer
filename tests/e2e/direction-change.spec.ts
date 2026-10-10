import { expect, test } from "@playwright/test";
test("direction changes are authenticated saved observations, not manufactured events", async ({
  request,
}) => {
  const url =
    "http://127.0.0.1:3101/api/direction-changes?coin=BTC&bucketStart=2026-01-01T00:15:00.000Z";
  expect((await request.get(url)).status()).toBe(401);
  const headers = { "x-internal-api-secret": "e2e-internal-secret-at-least-32-chars" };
  const response = await request.get(url, { headers });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({ status: "NO_SELECTED_WALLETS", item: null });
  expect((await request.get(url.replace("00:15:00", "00:16:00"), { headers })).status()).toBe(400);
  expect(
    (await request.get("http://127.0.0.1:3101/api/direction-changes", { headers })).status(),
  ).toBe(400);
});
