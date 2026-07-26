import { expect, test } from "@playwright/test";

test("shows the single-user login screen", async ({ page }) => {
  await page.goto("/login");

  await expect(page).toHaveTitle(/ログイン/);
  await expect(page.getByRole("heading", { name: /オンチェーンの動きを/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Googleでログイン" })).toBeVisible();
  await expect(page.getByText("実際の売買注文やウォレット署名は行いません")).toBeVisible();
});

test("redirects an unauthenticated dashboard request to login", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("所有者ログイン")).toBeVisible();
});

test("rejects an unauthenticated address API request", async ({ request }) => {
  const response = await request.get("/api/addresses");

  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ error: "unauthorized" });
});
