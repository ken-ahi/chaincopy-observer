import { expect, test } from "@playwright/test";

import {
  e2eDiscoveryAddress,
  e2eManualPerformanceAddress,
  e2eSelectionAddress,
  e2eSessionToken,
} from "./fixtures";

test.describe("Wallet selection browser E2E", () => {
  test.describe.configure({ mode: "serial" });

  test("rejects unauthenticated selection API requests", async ({ request }) => {
    const response = await request.get("/api/wallet-selection");
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  test.describe("authenticated", () => {
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

    test("evaluates, configures, filters, and manually overrides monitored wallets", async ({
      page,
    }) => {
      await page.goto("/dashboard/selection");
      await expect(page.getByRole("heading", { name: "参考にするアドレス" })).toBeVisible();

      await page.getByRole("button", { name: "再評価" }).click();
      await expect(page.getByText("監視中のアドレスを再評価しました。")).toBeVisible();

      const selectedRow = page.locator("tr", {
        has: page.locator(`a[href="/dashboard/addresses/${e2eSelectionAddress}"]`),
      });
      await expect(selectedRow.getByText("参考対象", { exact: true })).toBeVisible();
      await expect(selectedRow).toContainText("+34%");
      await expect(selectedRow).toContainText("20件");

      const firstEvaluation = await page.request.post("/api/wallet-selection/evaluate");
      const secondEvaluation = await page.request.post("/api/wallet-selection/evaluate");
      const firstPayload = await firstEvaluation.json();
      const secondPayload = await secondEvaluation.json();
      expect(firstPayload.run.id).toBe(secondPayload.run.id);
      expect(secondPayload.reused).toBe(true);
      expect(
        secondPayload.items.find(
          (item: { readonly address: string }) => item.address === e2eSelectionAddress,
        ).performanceRunId,
      ).toBe("phase4-3-e2e-selected-performance-run");

      const reviewRow = page.locator("tr", {
        has: page.locator(`a[href="/dashboard/addresses/${e2eManualPerformanceAddress}"]`),
      });
      await expect(reviewRow.getByText("要確認", { exact: true })).toBeVisible();
      await expect(
        page.locator(`a[href="/dashboard/addresses/${e2eDiscoveryAddress}"]`),
      ).toHaveCount(0);
      expect(await page.locator("body").innerText()).not.toMatch(
        /NO_PERFORMANCE_V3|HISTORY_INCOMPLETE|DATA_STALE|wallet-selection-v1/,
      );

      await page.getByText("選定条件", { exact: true }).click();
      await page.getByLabel("自動選定する最大件数").fill("1");
      await page.getByRole("button", { name: "選定条件を保存" }).click();
      await expect(page.getByText("選定条件を保存しました。再評価してください。")).toBeVisible();
      await page.getByRole("button", { name: "再評価" }).click();
      await expect(page.getByText("監視中のアドレスを再評価しました。")).toBeVisible();
      const changedPolicyEvaluation = await page.request.get("/api/wallet-selection");
      expect((await changedPolicyEvaluation.json()).run.id).not.toBe(firstPayload.run.id);

      await selectedRow.getByRole("button", { name: "対象外にする" }).click();
      await expect(selectedRow.getByText("対象外", { exact: true })).toBeVisible();
      await expect(selectedRow.getByText("手動設定", { exact: true })).toBeVisible();
      await selectedRow.getByRole("button", { name: "自動判定に戻す" }).click();
      await expect(selectedRow.getByText("参考対象", { exact: true })).toBeVisible();

      await reviewRow.getByRole("button", { name: "参考対象にする" }).click();
      await expect(reviewRow.getByText("参考対象", { exact: true })).toBeVisible();
      await reviewRow.getByText("理由を見る", { exact: true }).click();
      await expect(reviewRow.getByText("成績をまだ確認できません")).toBeVisible();
      await reviewRow.getByRole("button", { name: "自動判定に戻す" }).click();
      await expect(reviewRow.getByText("要確認", { exact: true })).toBeVisible();

      await page.getByLabel("参考状態で絞り込む").selectOption("REVIEW");
      await expect(reviewRow).toBeVisible();
      await expect(selectedRow).toHaveCount(0);
    });
  });
});
