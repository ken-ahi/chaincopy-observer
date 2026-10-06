import { expect, test } from "@playwright/test";

test("saved observational Signals require authentication and never manufacture an empty cohort", async ({
  request,
}) => {
  const url =
    "http://127.0.0.1:3101/api/behavior-signals?coin=BTC&bucketStart=2026-01-01T00:00:00.000Z";
  expect((await request.get(url)).status()).toBe(401);
  const response = await request.get(url, {
    headers: { "x-internal-api-secret": "e2e-internal-secret-at-least-32-chars" },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({ status: "NO_SELECTED_WALLETS", item: null });
});
