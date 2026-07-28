import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

import {
  e2eDiscoveryAddress,
  e2eDiscoveryOtherAddress,
  e2eExclusionAddress,
  e2ePromotionAddress,
  e2eSessionToken,
} from "./fixtures";

test.describe.configure({ mode: "serial" });

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
  let candidateListRequestCount = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/discovery/candidates") {
      candidateListRequestCount += 1;
    }
  });
  await page.goto("/dashboard/discovery");
  await expect(page.getByRole("heading", { name: "Hyperliquid アドレス自動探索" })).toBeVisible();
  await expect(page.getByText("受信イベント")).toBeVisible();
  await expect(page.getByRole("button", { name: "探索開始" })).toBeEnabled();
  await expect(page.getByLabel("購読範囲")).toHaveValue("MAJOR");
  await expect(page.getByLabel("最低観測回数")).toHaveValue("10");
  await expect(page.getByRole("button", { name: "設定を保存" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "探索からPerformanceまで" })).toBeVisible();
  await expect(page.getByText("2. 詳細分析")).toBeVisible();
  await expect(page.getByText("6. Performanceを計算")).toBeVisible();

  const search = page.getByLabel("候補検索");
  await search.fill(e2eDiscoveryAddress);
  const candidateLink = page.locator(`a[href="/dashboard/discovery/${e2eDiscoveryAddress}"]`);
  await expect(candidateLink).toBeVisible();
  await expect(page.getByText("$15,000")).toBeVisible();
  const enrich = page.getByRole("button", {
    name: `${e2eDiscoveryAddress} を詳細分析`,
  });
  await expect(enrich).toBeVisible();
  await expect(
    page.getByRole("button", { name: `${e2eDiscoveryAddress} を監視対象に追加` }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: /CSV|JSON/i })).toHaveCount(0);

  const listRequestsBeforeEnrichment = candidateListRequestCount;
  await enrich.click();
  await expect(page.getByText("詳細分析を登録しました。")).toBeVisible();
  expect(candidateListRequestCount).toBe(listRequestsBeforeEnrichment);
  await expect(page.locator("tr").filter({ has: candidateLink })).toContainText("QUEUED");

  await search.fill("");
  const otherCandidateLink = page.locator(
    `a[href="/dashboard/discovery/${e2eDiscoveryOtherAddress}"]`,
  );
  await expect(otherCandidateLink).toBeVisible();
  await expect(page.locator("tr").filter({ has: otherCandidateLink })).toContainText("SUCCEEDED");

  await candidateLink.click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/discovery/${e2eDiscoveryAddress}$`));
  await expect(page.getByText(e2eDiscoveryAddress)).toBeVisible();
  await expect(page.getByRole("heading", { name: "観測統計" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "履歴完全性・除外理由" })).toBeVisible();
  await expect(page.getByRole("button", { name: "詳細分析を再実行" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "処理ステップ" })).toBeVisible();
});

test("prevents duplicate promotion while showing the pending state", async ({ page }) => {
  let promotionRequestCount = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith(`/api/discovery/candidates/${e2ePromotionAddress}/promote`)
    ) {
      promotionRequestCount += 1;
    }
  });
  await page.goto("/dashboard/discovery");
  await page.getByLabel("候補検索").fill(e2ePromotionAddress);

  const promote = page.getByRole("button", {
    name: `${e2ePromotionAddress} を監視対象に追加`,
  });
  await expect(promote).toBeEnabled();
  await promote.click();

  await expect(promote).toContainText("追加待ち");
  await expect(promote).toBeDisabled();
  expect(promotionRequestCount).toBe(1);
});

test("shows matching Web and API build information", async ({ page }) => {
  await page.goto("/dashboard");

  const version = page.getByLabel("稼働バージョン");
  await expect(version).toContainText("Web v0.2.0");
  await expect(version).toContainText("API v0.2.0");
  await expect(version).toContainText("unknown");
  await expect(version).toContainText("接続済み");
});

test("shows a Web/API mismatch warning", async ({ page }) => {
  await page.route("**/api/system/version", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        builtAt: "2026-07-28T14:26:12.528Z",
        commit: "1234567",
        service: "api",
        version: "0.2.0",
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/dashboard");

  await expect(page.getByText("Web/APIのビルドが一致していません")).toBeVisible();
});

test("keeps the dashboard usable when API build information is unavailable", async ({ page }) => {
  await page.route("**/api/system/version", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: "service_unavailable",
        message: "APIバージョン取得失敗",
      }),
      contentType: "application/json",
      status: 503,
    });
  });

  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Observation deck" })).toBeVisible();
  await expect(page.getByText("APIバージョン取得失敗")).toBeVisible();
});

test("rejects unauthenticated discovery API requests", async ({ request }) => {
  const response = await request.get("/api/discovery/stats");

  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toEqual({
    error: {
      code: "authentication_required",
      message: "Authentication is required.",
    },
  });
});

test("toggles candidate exclusion, queues re-evaluation, and cleans up", async ({ page }) => {
  const candidateId = await seedExclusionCandidate();
  try {
    await page.goto("/dashboard/discovery");
    await page.getByLabel("候補検索").fill(e2eExclusionAddress);

    const exclude = page.getByRole("button", {
      name: `${e2eExclusionAddress} を除外`,
    });
    await expect(exclude).toBeEnabled();
    const postRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith(`/api/discovery/candidates/${e2eExclusionAddress}/exclude`),
    );
    await exclude.click();
    await expect(postRequest).resolves.toBeDefined();
    await expect(page.getByText("候補を除外しました。")).toBeVisible();

    const unexclude = page.getByRole("button", {
      name: `${e2eExclusionAddress} を除外解除`,
    });
    await expect(unexclude).toBeEnabled();
    await expect(page.getByText("INSUFFICIENT_HISTORY, MANUALLY_EXCLUDED")).toBeVisible();
    await page.waitForTimeout(2_000);
    runLateLightweightFilter(candidateId);
    await page.getByRole("button", { name: "探索候補を再読み込み" }).click();
    await expect(unexclude).toBeEnabled();
    await expect(page.getByText("INSUFFICIENT_HISTORY, MANUALLY_EXCLUDED")).toBeVisible();
    await page.locator(`a[href="/dashboard/discovery/${e2eExclusionAddress}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/discovery/${e2eExclusionAddress}$`));
    const detailUnexclude = page.getByRole("button", {
      name: `${e2eExclusionAddress} を除外解除`,
    });
    await expect(detailUnexclude).toBeEnabled();
    const deleteRequest = page.waitForRequest(
      (request) =>
        request.method() === "DELETE" &&
        request.url().endsWith(`/api/discovery/candidates/${e2eExclusionAddress}/exclude`),
    );
    await detailUnexclude.click();
    await expect(deleteRequest).resolves.toBeDefined();

    await expect(page.getByText("候補の除外を解除し、再評価を登録しました。")).toBeVisible();
    await expect(page.getByRole("button", { name: `${e2eExclusionAddress} を除外` })).toBeEnabled();
    await expect(page.getByText("PENDING", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("INSUFFICIENT_HISTORY", { exact: true })).toBeVisible();
  } finally {
    await cleanupExclusionCandidate(candidateId);
  }

  const database = e2eDatabase();
  await expect(database.addressCandidate.count({ where: { id: candidateId } })).resolves.toBe(0);
  await database.$disconnect();
});

test("shows Phase 4 completion without enabling Phase 5 features", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page.getByText("Phase 4 · Performance analytics")).toBeVisible();
  await expect(page.getByText("Phase 4 complete")).toBeVisible();
  await expect(page.getByText("ランキング・分析")).toBeVisible();
  await expect(page.getByText("現在は利用できません")).toBeVisible();
});

function e2eDatabase(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: e2eDatabaseUrl() } } });
}

function e2eDatabaseUrl(): string {
  const url = new URL(
    process.env.DATABASE_URL ??
      "postgresql://chaincopy:chaincopy@127.0.0.1:5432/chaincopy?schema=public",
  );
  if (url.hostname === "postgres") {
    url.hostname = "127.0.0.1";
  }
  url.searchParams.set("schema", "chaincopy_e2e");
  return url.toString();
}

async function seedExclusionCandidate(): Promise<string> {
  const database = e2eDatabase();
  try {
    const source = await database.dataSource.findUniqueOrThrow({
      where: { key: "hyperliquid-mainnet" },
    });
    await database.addressCandidate.deleteMany({ where: { address: e2eExclusionAddress } });
    const candidate = await database.addressCandidate.create({
      data: {
        activeDays: 2,
        activeHours: 8,
        address: e2eExclusionAddress,
        averageTradeUsd: "1600",
        dataQualityScore: 70,
        distinctCoins: 1,
        enrichmentStatus: "QUEUED",
        estimatedNotionalUsd: "16000",
        exclusionReasons: ["INSUFFICIENT_HISTORY"],
        filterStatus: "LIGHT_ELIGIBLE",
        firstSeenAt: new Date("2026-07-26T00:00:00.000Z"),
        largestTradeUsd: "6000",
        lastSeenAt: new Date("2026-07-27T00:00:00.000Z"),
        sourceId: source.id,
        tradeCount: 10,
      },
    });
    return candidate.id;
  } finally {
    await database.$disconnect();
  }
}

async function cleanupExclusionCandidate(candidateId: string): Promise<void> {
  const database = e2eDatabase();
  try {
    await database.addressCandidate.deleteMany({ where: { id: candidateId } });
  } finally {
    await database.$disconnect();
  }
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'import { Queue } from "bullmq";',
        'const queue = new Queue("hyperliquid-discovery", { connection: { db: 15, host: "127.0.0.1", port: 6379 } });',
        'const jobs = await queue.getJobs(["waiting", "delayed", "prioritized", "completed", "failed"]);',
        'await Promise.all(jobs.filter((job) => job.data?.kind === "candidate" && job.data?.candidateId === process.env.E2E_CANDIDATE_ID).map((job) => job.remove()));',
        "await queue.close();",
      ].join(" "),
    ],
    {
      cwd: resolve(process.cwd(), "apps/api"),
      env: { ...process.env, E2E_CANDIDATE_ID: candidateId },
      stdio: "pipe",
    },
  );
}

function runLateLightweightFilter(candidateId: string): void {
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      [
        'import { PrismaClient } from "@chaincopy/database";',
        'import { HyperliquidDiscoveryRepository } from "./src/hyperliquid/discovery/repository.ts";',
        "const database = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });",
        "const candidate = await database.addressCandidate.findUniqueOrThrow({ where: { id: process.env.E2E_CANDIDATE_ID } });",
        "const repository = new HyperliquidDiscoveryRepository(database, candidate.sourceId);",
        'await repository.updateLightFilter(candidate.id, "LIGHT_ELIGIBLE", []);',
        "await database.$disconnect();",
      ].join(" "),
    ],
    {
      cwd: resolve(process.cwd(), "apps/worker"),
      env: {
        ...process.env,
        DATABASE_URL: e2eDatabaseUrl(),
        E2E_CANDIDATE_ID: candidateId,
      },
      stdio: "pipe",
    },
  );
}
