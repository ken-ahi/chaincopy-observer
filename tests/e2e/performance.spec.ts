import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

import {
  e2eInsufficientPerformanceAddress,
  e2eManualPerformanceAddress,
  e2ePartialPerformanceAddress,
  e2ePerformanceAddress,
  e2eSessionToken,
} from "./fixtures";

const sensitivePattern =
  /INTERNAL_API_SECRET|DATABASE_URL|postgres:5432|redis:6379|api:3001|PrismaClient|at\s+\S+\.tsx?:\d+|[A-Z]:\\[^\s]+/iu;

test.describe("Performance browser E2E", () => {
  test.describe.configure({ mode: "serial" });

  test("未認証のアドレス詳細アクセスを安全に拒否する", async ({ page }) => {
    await page.goto(`/dashboard/addresses/${e2ePerformanceAddress}`);

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("所有者ログイン")).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(sensitivePattern);
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

    test("履歴不足Runを簡素化表示し診断Codeを計算の詳細へ分離する", async ({ page }) => {
      await openAddressDetail(page, e2eInsufficientPerformanceAddress);

      await expect(page.getByRole("heading", { exact: true, name: "運用実績" })).toBeVisible();
      await expect(page.getByText("データ不足").first()).toBeVisible();
      await expect(page.getByText("現在表示できる主要指標はありません")).toBeVisible();
      await expect(page.getByText("MINIMUM_HISTORY_NOT_MET")).toHaveCount(0);
      await expect(page.getByText("INSUFFICIENT_HISTORY · 履歴不足")).toHaveCount(0);
      await expect(page.getByText("累積収益率")).toHaveCount(0);

      await page.getByRole("button", { name: "計算の詳細を開く" }).click();
      await expect(page.getByText("MINIMUM_HISTORY_NOT_MET").first()).toBeVisible();
      await expect(page.getByText("INSUFFICIENT_HISTORY · 履歴不足").first()).toBeVisible();
      await expect(page.getByText("UNAVAILABLE · 算出不可").first()).toBeVisible();
      expect(await page.locator("body").innerText()).not.toMatch(sensitivePattern);
    });

    test("未計算の監視アドレスを手動計算し、完了状態まで更新する", async ({ page }) => {
      await openAddressDetail(page, e2eManualPerformanceAddress);

      await expect(page.getByText(/まだ計算されていません/)).toBeVisible();
      const calculateButton = page.getByRole("button", { name: "実績を計算" });
      await expect(calculateButton).toBeEnabled();
      await calculateButton.click();
      await expect(page.getByText("計算待ち").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "計算待ち" })).toBeDisabled();

      await completeManualPerformanceFixture();

      await expect(page.getByText("データ不足").first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByRole("button", { name: "実績を再計算" })).toBeEnabled();
      expect(await page.locator("body").innerText()).not.toMatch(sensitivePattern);
    });

    test("成功Runの主要指標、説明button、2つの詳細領域を表示する", async ({ page }) => {
      const performanceResponses = trackPerformanceResponses(page);
      await openAddressDetail(page, e2ePerformanceAddress);

      await expect(page.getByRole("heading", { exact: true, name: "運用実績" })).toBeVisible();
      await expect(page.getByText("計算完了").first()).toBeVisible();
      await expect(page.getByText("performance-v3")).toHaveCount(0);
      await expect(page.getByText("12.3456%")).toBeVisible();
      await expect(page.getByText("-4.5%")).toBeVisible();
      await expect(page.getByText("62.5%")).toBeVisible();
      await expect(page.getByText("1.234567")).toHaveCount(0);

      const missingMetric = page.locator('[data-metric-key="annualizedReturn"]');
      await expect(missingMetric).toHaveCount(0);

      const explanation = page.getByRole("button", { name: "累積収益率の説明" });
      await expect(explanation).toHaveAttribute("aria-expanded", "false");
      await explanation.click();
      await expect(explanation).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText(/入出金の影響を調整したうえで/)).toBeVisible();
      await explanation.press("Enter");
      await expect(explanation).toHaveAttribute("aria-expanded", "false");
      await explanation.press("Space");
      await expect(explanation).toHaveAttribute("aria-expanded", "true");

      await page.getByRole("button", { name: "詳細指標を開く" }).click();
      await expect(page.getByText("1.234567")).toBeVisible();
      await expect(page.getByText("2.5×")).toBeVisible();
      await expect(page.getByText("55%")).toBeVisible();

      await page.getByRole("button", { name: "計算の詳細を開く" }).click();
      await expect(page.getByText("performance-v3").first()).toBeVisible();
      await expect(page.getByText("EXACT · 正確").first()).toBeVisible();
      await expect(page.getByText("COMPLETE · 完全").first()).toBeVisible();
      await expect(page.getByText("phase4e-e2e-success-run")).toBeVisible();
      await expect(page.getByText(/abcdef1234567890/)).toBeVisible();
      await expect(page.getByText("Warning Codes").first()).toBeVisible();
      await expect(page.getByText("計算要求日時")).toBeVisible();
      await expect(page.getByText("計算開始日時")).toBeVisible();
      await expect(page.getByText("計算完了日時")).toBeVisible();

      await expect(page.getByRole("heading", { name: "現在ポジション" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "約定履歴" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Sync Cursor" })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Data Quality Issue/ })).toBeVisible();

      await assertNoSensitiveData(page, performanceResponses);
    });

    test("PARTIALかつUNKNOWN_CASH_FLOWでも信頼済み取引指標を保持する", async ({ page }) => {
      await openAddressDetail(page, e2ePartialPerformanceAddress);

      await expect(page.getByText("計算完了").first()).toBeVisible();
      await expect(page.locator('[data-metric-key="winRate"]')).toContainText("100%");
      await expect(page.locator('[data-metric-key="twr"]')).toHaveCount(0);
      await expect(page.getByText(/分類できない入出金/)).toHaveCount(0);

      await page.getByRole("button", { name: "詳細指標を開く" }).click();
      await expect(page.getByText(/分類できない入出金/).first()).toBeVisible();

      await page.getByRole("button", { name: "計算の詳細を開く" }).click();
      await expect(page.getByText("除外Fill件数")).toBeVisible();
      await expect(page.getByText("BTC: 1件除外")).toBeVisible();

      await page.reload();
      await expect(page.locator('[data-metric-key="winRate"]')).toContainText("100%");
      await expect(page.locator('[data-metric-key="twr"]')).toHaveCount(0);
      expect(await page.locator("body").innerText()).not.toMatch(sensitivePattern);
    });

    test("日次NAV一覧・概要・SVGチャートを表示する", async ({ page }) => {
      await openAddressDetail(page, e2ePerformanceAddress);

      await page.getByRole("button", { name: "詳細指標を開く" }).click();
      await expect(page.getByRole("heading", { name: "日次評価額" })).toBeVisible();
      await expect(page.getByText("日次NAV概要")).toBeVisible();
      const table = page.getByRole("table", { name: "日次NAV一覧" });
      await expect(table.getByRole("row")).toHaveCount(4);
      await expect(page.getByRole("img", { name: "日付順の日次NAV推移" })).toBeVisible();
      await expect(table.getByText("1000.123456789012").first()).toBeVisible();
      await expect(table.getByText("+0.125")).toBeVisible();
      await expect(table.getByText("-0.25")).toBeVisible();
      await expect(table.getByText("2026/06/01")).toBeVisible();
      const firstRow = table.getByRole("row").filter({ hasText: "2026/06/01" });
      await expect(firstRow).toContainText("—");
      await expect(firstRow).not.toContainText("NaN");
      expect(await page.locator("body").innerText()).not.toMatch(sensitivePattern);
    });

    test("Position Cycle一覧とクライアントフィルターを表示する", async ({ page }) => {
      await openAddressDetail(page, e2ePerformanceAddress);

      await page.getByRole("button", { name: "詳細指標を開く" }).click();
      await expect(page.getByRole("heading", { name: "取引サイクル" })).toBeVisible();
      const table = page.getByRole("table", { name: "取引サイクル一覧" });
      await expect(table.getByRole("row")).toHaveCount(4);
      await expect(table.getByText("ロング", { exact: true }).first()).toBeVisible();
      await expect(table.getByText("ショート", { exact: true })).toBeVisible();
      await expect(table.getByText("保有中", { exact: true })).toBeVisible();
      await expect(table.getByText("完了", { exact: true }).first()).toBeVisible();
      await expect(table.getByText("+99.5 · Profit")).toBeVisible();
      await expect(table.getByText("-77.875 · Loss")).toBeVisible();

      await page.getByRole("combobox", { name: "銘柄" }).selectOption("ETH");
      await expect(table.getByRole("row")).toHaveCount(2);
      await expect(table).toContainText("ETH");
      await page.getByRole("combobox", { name: "銘柄" }).selectOption("ALL");

      await page.getByRole("combobox", { name: "方向" }).selectOption("SHORT");
      await expect(table.getByRole("row")).toHaveCount(2);
      await expect(table).toContainText("ショート");
      await page.getByRole("combobox", { name: "方向" }).selectOption("ALL");

      await page.getByRole("combobox", { name: "状態" }).selectOption("OPEN");
      await expect(table.getByRole("row")).toHaveCount(2);
      await expect(table).toContainText("保有中");
      await page.getByRole("combobox", { name: "状態" }).selectOption("ALL");

      await page.getByRole("combobox", { name: "損益" }).selectOption("PROFIT");
      await expect(table.getByRole("row")).toHaveCount(2);
      await expect(table).toContainText("Profit");
      await page.getByRole("combobox", { name: "損益" }).selectOption("LOSS");
      await expect(table.getByRole("row")).toHaveCount(2);
      await expect(table).toContainText("Loss");
      await page.getByRole("combobox", { name: "損益" }).selectOption("BREAK_EVEN");
      await expect(table.getByRole("row")).toHaveCount(2);
      await expect(table).toContainText("Break-even");

      await page.getByRole("combobox", { name: "損益" }).selectOption("ALL");
      await page.getByRole("combobox", { name: "銘柄" }).selectOption("BTC");
      await page.getByRole("combobox", { name: "方向" }).selectOption("SHORT");
      await expect(page.getByText("条件に一致する取引サイクルがありません")).toBeVisible();
      expect(await page.locator("body").innerText()).not.toMatch(sensitivePattern);
    });
  });

  test("未認証のPerformance計算要求を拒否する", async ({ request }) => {
    const response = await request.post(
      `/api/addresses/${e2eManualPerformanceAddress}/performance/calculate`,
    );

    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });
});

async function openAddressDetail(page: Page, address: string): Promise<void> {
  const detailResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/addresses/${address}` && response.request().method() === "GET";
  });
  await page.goto(`/dashboard/addresses/${address}`);
  const detailResponse = await detailResponsePromise;
  expect(detailResponse.status()).toBe(200);
}

function trackPerformanceResponses(page: Page): Array<Promise<string>> {
  const bodies: Array<Promise<string>> = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes("/performance")) {
      bodies.push(response.text().catch(() => ""));
    }
  });
  return bodies;
}

async function assertNoSensitiveData(
  page: Page,
  responseBodies: ReadonlyArray<Promise<string>>,
): Promise<void> {
  expect(await page.locator("html").innerText()).not.toMatch(sensitivePattern);
  for (const body of await Promise.all(responseBodies)) {
    expect(body).not.toMatch(sensitivePattern);
  }
}

async function completeManualPerformanceFixture(): Promise<void> {
  const database = new PrismaClient({
    datasources: {
      db: {
        url:
          process.env.DATABASE_URL ??
          "postgresql://chaincopy:chaincopy@127.0.0.1:5432/chaincopy?schema=chaincopy_e2e",
      },
    },
  });
  try {
    const wallet = await database.walletAddress.findFirstOrThrow({
      where: { address: e2eManualPerformanceAddress },
    });
    await database.metricCalculationRun.create({
      data: {
        calculationFrom: wallet.createdAt,
        calculationTo: wallet.createdAt,
        calculationVersion: "performance-v3",
        completedAt: new Date(),
        deduplicationKey: `phase4-completion-e2e-${Date.now()}`,
        errorCode: "INSUFFICIENT_DATA",
        errorMessage: "Not enough persisted history.",
        historyCompleteness: "INSUFFICIENT_HISTORY",
        inputFingerprint: `phase4-completion-${Date.now()}`.padEnd(64, "0").slice(0, 64),
        precision: "UNAVAILABLE",
        requestedAt: new Date(),
        requestedBy: "phase4-completion-e2e",
        startedAt: new Date(),
        status: "INSUFFICIENT_DATA",
        walletAddressId: wallet.id,
        warningCodes: ["MINIMUM_HISTORY_NOT_MET"],
        warningCount: 1,
      },
    });
  } finally {
    await database.$disconnect();
  }
}
