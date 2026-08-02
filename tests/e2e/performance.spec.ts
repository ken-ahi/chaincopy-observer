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

const internalUiTerms = [
  "Sync Cursor",
  "Sync Job",
  "Run ID",
  "Input Fingerprint",
  "Warning Codes",
  "Calculation Version",
  "performance-v3",
];

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

    test("履歴不足でも主要6指標を消さず、内部Codeを表示しない", async ({ page }) => {
      await openAddressDetail(page, e2eInsufficientPerformanceAddress);

      await expect(
        page.getByRole("heading", { exact: true, name: "このアドレスの売買成績" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "売買成績を見る" })).toHaveCount(0);
      await expect(page.locator("[data-metric-key]")).toHaveCount(6);
      await expect(page.locator('[data-metric-key="cumulativeReturn"]')).toContainText("-");
      await expect(page.getByText(/成績の確かさ/)).toBeVisible();
      await expect(page.getByText("低い", { exact: true })).toBeVisible();
      await expect(page.locator('[data-metric-key="cumulativeReturn"]')).toContainText("履歴不足");
      await expect(page.getByText(/履歴が不足しているため/)).toHaveCount(0);
      await assertInternalTermsHidden(page);

      await page.getByRole("button", { name: "詳しい理由を見る" }).click();
      await expect(page.getByText(/履歴が不足しているため/)).toBeVisible();
      await expect(page.getByText("確認できた取引数")).toBeVisible();
      await assertInternalTermsHidden(page);
    });

    test("未計算の監視アドレスを手動計算し、完了状態まで更新する", async ({ page }, testInfo) => {
      const manualAddress = await createManualPerformanceWallet(testInfo.retry);

      await openAddressDetail(page, manualAddress);

      await expect(page.getByText(/まだ成績を計算していません/)).toBeVisible();
      await expect(page.locator("[data-metric-key]")).toHaveCount(6);

      const calculateButton = page.getByRole("button", { name: "成績を計算" });
      await expect(calculateButton).toBeEnabled();
      await calculateButton.click();

      await expect(page.getByText("成績を計算中", { exact: true })).toBeVisible();
      await expect(page.getByText("成績の確かさ：確認中")).toBeVisible();
      await expect(page.getByRole("button", { name: "計算中" })).toBeDisabled();

      await completeManualPerformanceFixture(manualAddress);

      await expect(page.getByText("成績を計算できませんでした")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: "成績を再計算" })).toBeEnabled();
    });

    test("成功時は初心者向け成績、確かさ、保有、最近の動き、未成立注文を表示する", async ({
      page,
    }) => {
      const requestedPaths = trackAddressRequests(page, e2ePerformanceAddress);
      const performanceResponses = trackPerformanceResponses(page);
      await openAddressDetail(page, e2ePerformanceAddress);

      await expect(
        page.getByRole("heading", { exact: true, name: "このアドレスの売買成績" }),
      ).toBeVisible();
      await expect(page.getByText("計算完了")).toHaveCount(0);
      await expect(page.getByText("最新の計算試行")).toHaveCount(0);
      await expect(page.locator("[data-metric-key]")).toHaveCount(6);
      await expect(page.getByText("12.3456%")).toBeVisible();
      await expect(page.getByText("-4.5%")).toBeVisible();
      await expect(page.getByText("62.5%")).toBeVisible();
      await expect(page.getByText(/成績の確かさ/)).toBeVisible();
      await expect(page.getByText("高い", { exact: true })).toBeVisible();

      const explanation = page.getByRole("button", {
        name: "資産の増減の説明",
      });
      await expect(explanation).toHaveAttribute("aria-expanded", "false");
      await explanation.click();
      await expect(page.getByText(/最初と比べて、資産が何％増えたか/)).toBeVisible();
      await explanation.press("Enter");
      await expect(explanation).toHaveAttribute("aria-expanded", "false");

      await expect(page.getByRole("heading", { name: "現在の先物ポジション" })).toBeVisible();
      await expect(page.getByText("買い", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "現在保有している通貨" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "最近の動き" })).toBeVisible();
      await expect(page.getByText("買いました", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "現在出している注文" })).toBeVisible();

      await page.getByRole("button", { name: "成績をくわしく見る" }).click();
      await expect(page.getByText("値動きに対する収益")).toBeVisible();
      await page.getByRole("button", { name: "詳しい理由を見る" }).click();
      await expect(page.getByRole("heading", { name: "詳しい理由" })).toBeVisible();
      await assertInternalTermsHidden(page);

      expect(requestedPaths).toEqual(
        expect.arrayContaining([
          `/api/addresses/${e2ePerformanceAddress}`,
          `/api/addresses/${e2ePerformanceAddress}/fills?limit=10`,
          `/api/addresses/${e2ePerformanceAddress}/orders?limit=10&status=open`,
          `/api/addresses/${e2ePerformanceAddress}/positions`,
        ]),
      );
      expect(requestedPaths.some((path) => path.includes("limit=100"))).toBe(false);
      for (const hiddenEndpoint of ["/funding", "/ledger", "/data-quality", "/sync-status"]) {
        expect(requestedPaths.some((path) => path.includes(hiddenEndpoint))).toBe(false);
      }
      await assertNoSensitiveData(page, performanceResponses);
    });

    test("一部履歴だけ利用可能な場合は具体的な確かさを表示する", async ({ page }) => {
      await openAddressDetail(page, e2ePartialPerformanceAddress);

      await expect(page.locator('[data-metric-key="winRate"]')).toContainText("100%");
      await expect(page.locator("[data-metric-key]")).toHaveCount(6);
      await expect(page.getByText("低い", { exact: true })).toBeVisible();
      await expect(page.getByText("一部の履歴が不足しています")).toBeVisible();
      await expect(page.getByText("追加の注意事項があります")).toHaveCount(0);
      await assertInternalTermsHidden(page);
    });

    test("ヘッダーは正常時の工程・version・接続表示を隠し、異常時だけ警告する", async ({
      page,
    }) => {
      await page.route("**/api/system/version", async (route) => route.abort());
      await openAddressDetail(page, e2ePerformanceAddress);

      await expect(
        page.getByText("最新データを取得できません。表示内容が古い可能性があります。"),
      ).toBeVisible();
      await expect(page.getByText("Phase 3 · Discovery")).toHaveCount(0);
      await expect(page.getByText(/Web v0\.3\.1/)).toHaveCount(0);
      await expect(page.getByText(/API v0\.3\.1/)).toHaveCount(0);
      await expect(page.getByText("接続済み", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "ホーム" })).toBeAttached();
      await expect(page.getByRole("link", { name: "監視中のアドレス" }).first()).toBeAttached();
      await expect(page.getByRole("link", { name: "優良アドレスを探す" })).toBeAttached();
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

function trackAddressRequests(page: Page, address: string): Array<string> {
  const paths: Array<string> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith(`/api/addresses/${address}`)) {
      paths.push(`${url.pathname}${url.search}`);
    }
  });
  return paths;
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

async function assertInternalTermsHidden(page: Page): Promise<void> {
  for (const term of internalUiTerms) {
    await expect(page.getByText(term, { exact: false })).toHaveCount(0);
  }
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

async function completeManualPerformanceFixture(address: string): Promise<void> {
  const database = databaseClient();
  try {
    const wallet = await database.walletAddress.findFirstOrThrow({ where: { address } });
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

async function createManualPerformanceWallet(retry: number): Promise<string> {
  const suffix = (retry + 1).toString(16).padStart(2, "0");
  const address = `0x${"a".repeat(38)}${suffix}`;
  const database = databaseClient();

  try {
    const template = await database.walletAddress.findFirstOrThrow({
      select: { ownerUserId: true, sourceId: true },
      where: { address: e2eManualPerformanceAddress },
    });
    await database.walletAddress.create({
      data: {
        address,
        displayName: `E2E Performance Manual Retry ${String(retry)}`,
        isWatched: true,
        ownerUserId: template.ownerUserId,
        sourceId: template.sourceId,
      },
    });
    return address;
  } finally {
    await database.$disconnect();
  }
}

function databaseClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url:
          process.env.DATABASE_URL ??
          "postgresql://chaincopy:chaincopy@127.0.0.1:5432/chaincopy?schema=chaincopy_e2e",
      },
    },
  });
}
