import { expect, test } from "@playwright/test";

import { e2eAddress, e2eSessionToken } from "./fixtures";

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

test("registers, deduplicates, watches, syncs, and opens an address", async ({ page }) => {
  await page.goto("/dashboard/addresses");
  await expect(page.getByRole("heading", { name: "監視アドレス" })).toBeVisible();
  const search = page.getByLabel("アドレス検索");
  const [emptyResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/addresses" &&
        url.searchParams.get("search") === "__phase2_empty_state__"
      );
    }),
    search.fill("__phase2_empty_state__"),
  ]);
  expect(emptyResponse.status()).toBe(200);
  await expect(emptyResponse.json()).resolves.toMatchObject({ items: [] });
  await expect(page.getByText("条件に一致するアドレスはありません。")).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/addresses" && !url.searchParams.has("search");
    }),
    search.fill(""),
  ]);

  await page.getByLabel("Hyperliquidアドレス").fill("invalid");
  await page.getByRole("button", { name: "登録" }).click();
  await expect(
    page.getByText("0x から始まる40桁の16進数アドレスを入力してください。"),
  ).toBeVisible();

  await page.getByLabel("Hyperliquidアドレス").fill(e2eAddress);
  await page.getByLabel("表示名").fill("E2E public address");
  await page.getByLabel("ウォッチON").uncheck();
  await page.getByRole("button", { name: "登録" }).click();
  await expect(page.getByText("ウォッチOFFで登録しました。")).toBeVisible();
  await expect(page.getByText("E2E public address")).toBeVisible();

  await page.getByLabel("Hyperliquidアドレス").fill(`0x${e2eAddress.slice(2).toUpperCase()}`);
  await page.getByRole("button", { name: "登録" }).click();
  await expect(page.getByText("このアドレスはすでに登録されています。")).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: "E2E public address" });
  await row.getByRole("button", { name: "ON" }).click();
  await expect(page.getByText(/ウォッチを開始しました/)).toBeVisible();
  await row.getByRole("button", { name: "同期" }).click();
  await expect(page.getByText(/同期ジョブを登録しました:/)).toBeVisible();

  await row.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/addresses/${e2eAddress}$`));
  await expect(page.getByText(e2eAddress)).toBeVisible();
  await expect(page.getByRole("heading", { name: "現在の先物ポジション" })).toBeVisible();
  await expect(page.getByText("現在の先物ポジションはありません。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近の動き" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sync Cursor" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Data Quality Issue/ })).toHaveCount(0);
});
