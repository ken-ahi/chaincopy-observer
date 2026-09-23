import { expect, test } from "@playwright/test";

import {
  e2eDiscoveryAddress,
  e2eManualPerformanceAddress,
  e2eSelectionAddress,
  e2eSessionToken,
} from "./fixtures";

test.describe("Wallet selection browser E2E", () => {
  test.describe.configure({ mode: "serial" });

  test("rejects unauthenticated selection and ranking API requests", async ({ request }) => {
    for (const path of ["/api/wallet-selection", "/api/wallet-selection/ranking"]) {
      const response = await request.get(path);
      expect(response.status()).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "authentication_required" },
      });
    }
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

    test("shows only Discovery-promoted wallets that pass the automatic hard gates", async ({
      page,
    }) => {
      const firstEvaluation = await page.request.post("/api/wallet-selection/evaluate");
      expect(firstEvaluation.ok()).toBe(true);
      const secondEvaluation = await page.request.post("/api/wallet-selection/evaluate");
      const firstPayload = await firstEvaluation.json();
      const secondPayload = await secondEvaluation.json();
      expect(firstPayload.run.id).toBe(secondPayload.run.id);
      expect(secondPayload.reused).toBe(true);

      await page.goto("/dashboard/selection");
      await expect(page.getByRole("heading", { name: "参考ウォレットランキング" })).toBeVisible();

      const selectedRow = page.locator("tr", {
        has: page.locator(`a[href="/dashboard/addresses/${e2eSelectionAddress}"]`),
      });
      await expect(selectedRow.getByText("参考対象", { exact: true })).toBeVisible();
      await expect(selectedRow).toContainText("+34%");
      await expect(selectedRow).toContainText("55%");
      await expect(selectedRow).toContainText("2.1");
      await expect(selectedRow).toContainText("20件");

      await expect(
        page.locator(`a[href="/dashboard/addresses/${e2eManualPerformanceAddress}"]`),
      ).toHaveCount(0);
      await expect(
        page.locator(`a[href="/dashboard/addresses/${e2eDiscoveryAddress}"]`),
      ).toHaveCount(0);
      await expect(page.getByText("要確認", { exact: true })).toHaveCount(0);
      await expect(page.getByText("対象外", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "参考対象にする" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "再評価" })).toHaveCount(0);

      const ranking = await page.request.get("/api/wallet-selection/ranking");
      await expect(ranking.json()).resolves.toMatchObject({
        items: [
          {
            address: e2eSelectionAddress,
            automaticStatus: "SELECTED",
            performanceRunId: "phase4-3-e2e-selected-performance-run",
            rank: 1,
          },
        ],
        run: { eligibleCount: 1, selectedCount: 1 },
      });
    });

    test("keeps manual EXCLUDE as an administrative denylist without exposing controls", async ({
      page,
    }) => {
      const exclude = await page.request.patch(
        `/api/wallet-selection/${e2eSelectionAddress}/override`,
        { data: { decision: "EXCLUDE", note: "e2e denylist" } },
      );
      expect(exclude.ok()).toBe(true);
      await page.goto("/dashboard/selection");
      await expect(
        page.getByText("現在、履歴・成績・リスクの全条件を通過したウォレットはありません。"),
      ).toBeVisible();

      const restore = await page.request.patch(
        `/api/wallet-selection/${e2eSelectionAddress}/override`,
        { data: { decision: "AUTO", note: null } },
      );
      expect(restore.ok()).toBe(true);
      await page.reload();
      await expect(
        page.locator(`a[href="/dashboard/addresses/${e2eSelectionAddress}"]`),
      ).toBeVisible();
    });
  });
});
