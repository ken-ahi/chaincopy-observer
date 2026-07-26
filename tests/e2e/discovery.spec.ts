import { expect, test } from "@playwright/test";

import { e2eDiscoveryAddress, e2eSessionToken } from "./fixtures";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      domain: "127.0.0.1",
      httpOnly: true,
      name: "next-auth.session-token",
      path: "/",
      sameSite: "Lax",
      secure: false,
      value: e2eSessionToken,
    },
  ]);
});

test("shows discovery stats, settings, candidates, and candidate detail", async ({ page }) => {
  await page.goto("/dashboard/discovery");
  await expect(page.getByRole("heading", { name: "Hyperliquid アドレス自動探索" })).toBeVisible();
  await expect(page.getByText("受信イベント")).toBeVisible();
  await expect(page.getByRole("button", { name: "探索開始" })).toBeEnabled();
  await expect(page.getByLabel("購読範囲")).toHaveValue("MAJOR");
  await expect(page.getByLabel("最低観測回数")).toHaveValue("10");
  await expect(page.getByRole("button", { name: "設定を保存" })).toBeVisible();

  await page.getByLabel("候補検索").fill(e2eDiscoveryAddress);
  const candidateLink = page.getByRole("link", { name: /0xdddddd/ });
  await expect(candidateLink).toBeVisible();
  await expect(page.getByText("$15,000")).toBeVisible();
  await expect(
    page.getByRole("button", { name: `${e2eDiscoveryAddress} をEnrichment` }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `${e2eDiscoveryAddress} を監視対象へ昇格` }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: /CSV|JSON/i })).toHaveCount(0);

  await candidateLink.click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/discovery/${e2eDiscoveryAddress}$`));
  await expect(page.getByText(e2eDiscoveryAddress)).toBeVisible();
  await expect(page.getByRole("heading", { name: "観測統計" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "履歴完全性・除外理由" })).toBeVisible();
  await expect(page.getByRole("button", { name: "手動Enrichment" })).toBeVisible();
});

test("rejects unauthenticated discovery API requests", async ({ request }) => {
  const response = await request.get("/api/discovery/stats");

  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ error: "unauthorized" });
});
